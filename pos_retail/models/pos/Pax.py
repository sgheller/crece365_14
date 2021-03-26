# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.

from odoo import fields, models, api
import urllib.request
import base64

import logging

_logger = logging.getLogger(__name__)


class PaxTerminal(models.Model):
    _name = 'pax.terminal'
    _rec_name = 'ip_addr'
    _description = "Pax Terminal Device"

    ip_addr = fields.Char(string="PAX Device IP Address", required="1")
    port_no = fields.Char(string="Device Port", required="1", default=10009)
    protocol = fields.Char(string="Device Protocol", required="1", default=10009)

    def encodeValue(self, posParameter):
        _logger.info('[encodeValue]')
        _logger.info(posParameter)
        paxParam = []
        for info_index, info_group in enumerate(posParameter):
            paxParam.append(u'\u001c')
            if isinstance(posParameter[info_group], str):
                paxParam.append(posParameter[info_group])
                continue

            for value_index, value in enumerate(posParameter[info_group]):
                if value_index != 0:
                    paxParam.append(u'\u001f')
                paxParam.append(posParameter[info_group][value])
        paxParam[0] = u'\u0002'
        paxParam = bytearray("".join(paxParam), 'utf-8')
        paxParam += bytes(self.getCheckCharacter(paxParam), 'utf-8')
        paxParam = base64.b64encode(paxParam)
        result = paxParam.decode()
        _logger.info(result)
        return result

    def getCheckCharacter(self, paxParam):
        checkCharacter = 0
        paxParam = iter(paxParam)
        next(paxParam)
        for x in paxParam:
            checkCharacter ^= x
        checkCharacter ^= 3

        checkCharacter = u'\u0003' + chr(checkCharacter)
        if checkCharacter == 0:
            checkCharacter = 0
        return checkCharacter

    @api.model
    def payment_process(self, id, amount, test=False):
        _logger.info('Begin [payment_process] with Amount %s' % amount)
        if test:
            return {
                'response': 'ABORTED',
                'amount': amount,
            }
        vals = {}
        try:
            rec = self.browse(id)
            link = 'http://' + rec.ip_addr + ':' + rec.protocol + '/?AlQwMBwxLjI4HDAxHDEwMBwcMRwcHBwcA0M='
            htmlfile = urllib.request.urlopen(link)
            htmltext = htmlfile.read()
            htmltext = str(htmltext)
            if htmltext.find('ABORTED') != -1:
                vals.update({'response': 'ABORTED'})
                vals.update({'amount': amount})
            elif htmltext.find('TIMEOUT') != -1:
                vals.update({'response': 'TIMEOUT'})
        except Exception as e:
            _logger.error(e)
            vals.update({'response': 'TIMEOUT'})
        return vals


class PaxPayment(models.Model):
    _name = 'pax.payment'
    _description = "Pax Payment"

    amount = fields.Float(string="Amount")

    def payment_process(self):
        ip = self.env['pax.terminal'].search([])
        for i in ip:
            dev_ip = i.ip_addr
            dev_port = i.port_no
        link = 'http://' + dev_ip + ':' + dev_port + '/?AlQwMBwxLjI4HDAxHDEwMBwcMRwcHBwcA0M='
        htmlfile = urllib.request.urlopen(link)
        htmltext = htmlfile.read()
        print("########## Return Result From PAX ########### ", htmltext)
