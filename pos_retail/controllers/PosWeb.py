# -*- coding: utf-8 -*
from odoo.http import request
from odoo.addons.point_of_sale.controllers.main import PosController
import json
import werkzeug.utils
from odoo import http, _
from odoo.addons.web.controllers.main import ensure_db, Home, Session, WebClient
from passlib.context import CryptContext
from odoo import api, fields, models, _

crypt_context = CryptContext(schemes=['pbkdf2_sha512', 'plaintext'], deprecated=['plaintext'])
from datetime import datetime
import odoo
from odoo.osv.expression import AND
import timeit

import os
import jinja2

path = os.path.realpath(os.path.join(os.path.dirname(__file__), '../views'))
loader = jinja2.FileSystemLoader(path)

jinja_env = jinja2.Environment(loader=loader, autoescape=True)
jinja_env.filters["json"] = json.dumps

pos_display_template = jinja_env.get_template('pos_display.html')

version_info = odoo.release.version_info[0]

datetime.strptime('2012-01-01', '%Y-%m-%d')

import logging

_logger = logging.getLogger(__name__)


class pos_controller(PosController):

    @http.route(['/point_of_sale/display', '/point_of_sale/display/<string:display_identifier>'], type='http',
                auth='none')
    def display(self, display_identifier=None):
        cust_js = None
        parent_path = os.path.abspath(__file__ + "/../../")
        with open(parent_path + "/static/src/js/CustomerFacingScreen/Worker.js") as js:
            cust_js = js.read()

        display_ifaces = []
        return pos_display_template.render({
            'title': "Customer Display Screen",
            'breadcrumb': 'POS Client display',
            'cust_js': cust_js,
        })

    @http.route(['/pos/web', '/pos/ui'], type='http', auth='user')
    def pos_web(self, config_id=False, **k):
        start = timeit.default_timer()
        license_started_date = request.env['ir.config_parameter'].sudo().get_param('license_started_date')
        if not license_started_date:
            request.env['ir.config_parameter'].sudo().set_param('license_started_date', fields.Date.today())
        domain = [
            ('state', 'in', ['opening_control', 'opened']),
            ('user_id', '=', request.session.uid),
            ('rescue', '=', False)
        ]
        if config_id:
            domain = AND([domain, [('config_id', '=', int(config_id))]])
        pos_session = request.env['pos.session'].sudo().search(domain, limit=1)
        if not pos_session and config_id and request.env.user.pos_config_id and request.env.user.pos_config_id.id == int(
                config_id):
            pos_session = request.env['pos.session'].create({
                'user_id': request.env.user.id,
                'config_id': int(config_id),
            })
        if not pos_session or not config_id:
            return werkzeug.utils.redirect('/web#action=point_of_sale.action_client_pos_menu')
        # The POS only work in one company, so we enforce the one of the session in the context
        if request.env.user.id not in [1, 2] and not pos_session.config_id.restaurant_order:
            request.env['pos.remote.session'].sudo().closing_another_sessions_opened(pos_session.config_id.id, _(
                '%s opening your POS Session. We closing your session now', request.env.user.name), start)
        session_info = request.env['ir.http'].session_info()
        configs = request.env['pos.config'].search_read([
            ('id', '=', pos_session.config_id.id),
        ], [
            'id',
            'background',
            'primary_color',
            'secondary_color',
            'three_color',
            'cart_box_style',
            'product_width',
            'product_height',
            'cart_width',
            'cart_background',
            'font_family',
            'display_product_image',
            'payment_screen_background',
            'limited_products_display',
            # 'big_datas_turbo',
            'multi_session',
            'receipt_template',
            'product_screen_background',
            'header_color',
        ])
        config_data = configs[0]
        config_data['pos_session_id'] = pos_session.id
        session_info['config'] = config_data
        modules_installed = request.env['ir.module.module'].sudo().search([('name', '=', 'pos_retail')], limit=1)
        if not modules_installed:
            session_info['pos_retail'] = False
        else:
            session_info['pos_retail'] = True
        session_info['model_ids'] = {
            'product.product': {
                'min_id': 0,
                'max_id': 0,
            },
            'res.partner': {
                'min_id': 0,
                'max_id': 0
            },
        }
        request.env.cr.execute("select max(id) from product_product")
        product_max_ids = request.env.cr.fetchall()
        request.env.cr.execute("select count(id) from product_product")
        count_products = request.env.cr.fetchall()
        session_info['model_ids']['product.product']['max_id'] = product_max_ids[0][0] if len(
            product_max_ids) == 1 else 1
        session_info['model_ids']['product.product']['count'] = count_products[0][0] if len(
            count_products) == 1 else None
        request.env.cr.execute("select max(id) from res_partner")
        partner_max_ids = request.env.cr.fetchall()
        session_info['model_ids']['res.partner']['max_id'] = partner_max_ids[0][0] if len(partner_max_ids) == 1 else 10
        request.env.cr.execute("select count(id) from res_partner")
        count_partners = request.env.cr.fetchall()
        session_info['model_ids']['res.partner']['count'] = count_partners[0][0] if len(count_partners) == 1 else None
        session_info['user_context']['allowed_company_ids'] = pos_session.company_id.ids
        session_info['company_currency_id'] = request.env.user.company_id.currency_id.id
        session_info['license'] = request.env['ir.config_parameter'].sudo().get_param('license')
        if session_info['license']:
            license = session_info['license'].split(' ')[0]
            session_info['license'] = crypt_context.verify_and_update(request.env.cr.dbname, license)[0]
            if not session_info['license']:
                session_info['license'] = crypt_context.verify_and_update('saas_license', license)[0]
        session_info['config_id'] = config_id
        session_info['products_name'] = None
        session_info['partners_name'] = None
        session_info['start_time'] = start
        modules_installed = request.env['ir.module.module'].sudo().search([('name', '=', 'pos_retail')], limit=1)
        if not modules_installed:
            session_info['pos_retail'] = False
        else:
            session_info['pos_retail'] = True
        if pos_session.config_id.translate_products_name and pos_session.config_id.set_product_name_from_field:  # TODO: supported multi language products
            session_info['products_name'] = {}
            values = request.env['product.product'].sudo().search_read([
                ('available_in_pos', '=', True),
                ('%s' % pos_session.config_id.set_product_name_from_field, '!=', None),
            ], [pos_session.config_id.set_product_name_from_field])
            for val in values:
                session_info['products_name'][val['id']] = val[pos_session.config_id.set_product_name_from_field]
        if pos_session.config_id.replace_partners_name and pos_session.config_id.set_partner_name_from_field != 'name':
            session_info['partners_name'] = {}
            values = request.env['res.partner'].sudo().search_read([
                ('%s' % pos_session.config_id.set_partner_name_from_field, '!=', None),
            ], [pos_session.config_id.set_partner_name_from_field])
            for val in values:
                session_info['partners_name'][val['id']] = val[pos_session.config_id.set_partner_name_from_field]
        login_number = pos_session.login()
        session_info['opened_at'] = fields.Datetime.to_string(pos_session.opened_at)
        session_info['opened_uid'] = pos_session.opened_uid.id
        context = {
            'session_info': session_info,
            'login_number': login_number,
            'pos_session_id': pos_session.id,
        }
        _logger.info(
            '=========> [POS Started Session] with total seconds: %s <=============' % (timeit.default_timer() - start))
        return request.render('point_of_sale.index', qcontext=context)

    @http.route(['/public/scan'], type='http', auth='user')
    def publicScanPlacedOrder(self, uid=None, **kk):
        if not request.session.uid:
            return werkzeug.utils.redirect('/web/login', 303)
        _logger.info('Found UID %s of order via Scan QRCode', uid)
        sessions = request.env['pos.session'].sudo().search([
            ('state', '=', 'opened')
        ])
        for session in sessions:
            request.env['bus.bus'].sendmany(
                [[(request.env.cr.dbname, 'pos.confirm.place.order', session.user_id.id), {
                    'uid': uid
                }]])
        return request.render('pos_retail.scan_successfully', qcontext={
            'message': 'Hello, We are Master POS Team',
            'code': 200
        })

    @http.route(['/public/pos/web', '/public/pos/ui'], type='http', auth='public')
    def publicOrderController(self, table_id, config_id=False, **k):
        # http://192.168.31.193:8069/public/pos/web?table_id=3&config_id=3
        license_started_date = request.env['ir.config_parameter'].sudo().get_param('license_started_date')
        if not license_started_date:
            request.env['ir.config_parameter'].sudo().set_param('license_started_date', fields.Date.today())
        if not table_id or not config_id:
            return werkzeug.utils.redirect('/web/login')
        start = timeit.default_timer()
        config = request.env['pos.config'].sudo().browse(int(config_id))
        if not config.restaurant_order or not config.restaurant_order_login or not config.restaurant_order_password:
            return werkzeug.utils.redirect('/web/login')
        request.uid = odoo.SUPERUSER_ID
        try:
            uid = request.session.authenticate(request.session.db, config.restaurant_order_login,
                                               config.restaurant_order_password)
        except:
            values = {
                'error': _("Wrong login/password of account user %s", config.restaurant_order_login)
            }
            response = request.render('web.login', values)
            return response

        request.uid = uid
        request.session.temp_session = True
        request.params['login_success'] = True
        domain = [
            ('state', 'in', ['opening_control', 'opened']),
            ('user_id', '=', request.session.uid),
            ('rescue', '=', False)
        ]
        if config_id:
            domain = AND([domain, [('config_id', '=', int(config_id))]])
        pos_session = request.env['pos.session'].sudo().search(domain, limit=1)
        if not pos_session and config_id:
            pos_session = request.env['pos.session'].create({
                'user_id': request.env.user.id,
                'config_id': int(config_id),
            })
        if not pos_session or not config_id:
            return werkzeug.utils.redirect('/web#action=point_of_sale.action_client_pos_menu')
        # The POS only work in one company, so we enforce the one of the session in the context
        if request.env.user.id not in [1, 2] and not pos_session.config_id.restaurant_order:
            request.env['pos.remote.session'].sudo().closing_another_sessions_opened(pos_session.config_id.id, _(
                '%s opening your POS Session. We closing your session now', request.env.user.name), start)
        session_info = request.env['ir.http'].session_info()
        session_info['model_ids'] = {
            'product.product': {
                'min_id': 0,
                'max_id': 0,
            },
            'res.partner': {
                'min_id': 0,
                'max_id': 0
            },
        }
        request.env.cr.execute("select max(id) from product_product")
        product_max_ids = request.env.cr.fetchall()
        request.env.cr.execute("select count(id) from product_product")
        count_products = request.env.cr.fetchall()
        session_info['model_ids']['product.product']['max_id'] = product_max_ids[0][0] if len(
            product_max_ids) == 1 else 1
        session_info['model_ids']['product.product']['count'] = count_products[0][0] if len(
            count_products) == 1 else None
        request.env.cr.execute("select max(id) from res_partner")
        partner_max_ids = request.env.cr.fetchall()
        session_info['model_ids']['res.partner']['max_id'] = partner_max_ids[0][0] if len(partner_max_ids) == 1 else 10
        request.env.cr.execute("select count(id) from res_partner")
        count_partners = request.env.cr.fetchall()
        session_info['model_ids']['res.partner']['count'] = count_partners[0][0] if len(count_partners) == 1 else None
        session_info['user_context']['allowed_company_ids'] = pos_session.company_id.ids
        session_info['company_currency_id'] = request.env.user.company_id.currency_id.id
        session_info['license'] = request.env['ir.config_parameter'].sudo().get_param('license')
        if session_info['license']:
            license = session_info['license'].split(' ')[0]
            session_info['license'] = crypt_context.verify_and_update(request.env.cr.dbname, license)[0]
            if not session_info['license']:
                session_info['license'] = crypt_context.verify_and_update('saas_license', license)[0]
        session_info['config_id'] = config_id
        session_info['products_name'] = None
        session_info['partners_name'] = None
        session_info['start_time'] = start
        modules_installed = request.env['ir.module.module'].sudo().search([('name', '=', 'pos_retail')], limit=1)
        if not modules_installed:
            session_info['pos_retail'] = False
        else:
            session_info['pos_retail'] = True
        session_info['table_id'] = table_id
        session_info['restaurant_order'] = True
        if pos_session.config_id.translate_products_name and pos_session.config_id.set_product_name_from_field:  # TODO: supported multi language products
            session_info['products_name'] = {}
            values = request.env['product.product'].sudo().search_read([
                ('available_in_pos', '=', True),
                ('%s' % pos_session.config_id.set_product_name_from_field, '!=', None),
            ], [pos_session.config_id.set_product_name_from_field])
            for val in values:
                session_info['products_name'][val['id']] = val[pos_session.config_id.set_product_name_from_field]
        if pos_session.config_id.replace_partners_name and pos_session.config_id.set_partner_name_from_field != 'name':
            session_info['partners_name'] = {}
            values = request.env['res.partner'].sudo().search_read([
                ('%s' % pos_session.config_id.set_partner_name_from_field, '!=', None),
            ], [pos_session.config_id.set_partner_name_from_field])
            for val in values:
                session_info['partners_name'][val['id']] = val[pos_session.config_id.set_partner_name_from_field]
        context = {
            'session_info': session_info,
            'login_number': pos_session.login(),
        }
        _logger.info(
            '========== *** Guest LOGIN TO POS  %s *** =========' % (timeit.default_timer() - start))
        return requPoint
        Of
        Saleest.render('point_of_sale.index', qcontext=context)

    @http.route(['/pos/register/license'], type='http', auth='public')
    def registerLicense(self, license='', **k):
        """
        http://localhost:8069/pos/register/license?license=$pbkdf2-sha512$25000$LeV8750zBkDofa9VinHu/Q$ZK203.bCQvBUz4E8L/9dawdc7EHnihSikVCv9MQxNObb64RE2j2lKulNVF55LCf0L.LhjM36FxgVRJ4DxADoQw
        """
        request.env['ir.config_parameter'].sudo().set_param('license', license)
        return json.dumps({
            'code': 200
        })

    @http.route(['/pos/remove/license'], type='http', auth='public')
    def dropLicense(self, license='', **k):
        request.env['ir.config_parameter'].sudo().set_param('license', '')
        return json.dumps({
            'code': 200
        })


class web_login(Home):  # TODO: auto go directly POS when login

    def iot_login(self, db, login, password):
        try:
            request.session.authenticate(db, login, password)
            request.params['login_success'] = True
            return http.local_redirect('/pos/web/')
        except:
            return False

    @http.route()
    def web_login(self, *args, **kw):
        ensure_db()
        response = super(web_login, self).web_login(*args, **kw)
        if request.httprequest.method == 'GET' and kw.get('database', None) and kw.get('login', None) and kw.get(
                'password', None) and kw.get('iot_pos', None):
            return self.iot_login(kw.get('database', None), kw.get('login', None), kw.get('password', None))
        if request.session.uid:
            user = request.env['res.users'].browse(request.session.uid)
            pos_config = user.pos_config_id
            if pos_config:
                return http.local_redirect('/pos/web?config_id=%s' % int(pos_config.id))
        return response

    # Todo: if session is temp_session (session order), auto logout
    @http.route('/web', type='http', auth="none")
    def web_client(self, s_action=None, **kw):
        _logger.info(' /web called ..............')
        res = super(web_login, self).web_client(s_action, **kw)
        if request.session and request.session.uid:
            user = request.env['res.users'].sudo().browse(request.session.uid)
            if not user.allow_access_backend:
                _logger.warning('=====> %s have not permission access to backend. We remove this session now',
                                user.name)
                request.session.logout(keep_db=True)
                return werkzeug.utils.redirect('/web', 303)
        return res
