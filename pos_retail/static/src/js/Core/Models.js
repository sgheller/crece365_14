/*
    This module create by: thanhchatvn@gmail.com
    License: OPL-1
    Please do not modification if i'm not accepted
 */
odoo.define('pos_retail.model', function (require) {
    const models = require('point_of_sale.models');
    const utils = require('web.utils');
    const core = require('web.core');
    const round_pr = utils.round_precision;
    const _t = core._t;
    const rpc = require('pos.rpc');
    const session = require('web.session');
    const time = require('web.time');
    const Session = require('web.Session');
    const load_model = require('pos_retail.load_models');
    const {Printer} = require('point_of_sale.Printer');
    const {posbus} = require('point_of_sale.utils');


    models.load_models([
        {
            label: 'Your Odoo Server IP/Port and All POS Boxes',
            model: 'pos.iot',
            condition: function (self) {
                if (self.config.posbox_save_orders && self.config.posbox_save_orders_iot_ids.length) {
                    return true
                } else {
                    return false;
                }
            },
            fields: [],
            domain: function (self) {
                return [['id', 'in', self.config.posbox_save_orders_iot_ids]]
            },
            loaded: function (self, iot_boxes) {
                self.iot_boxes_save_orders_by_id = {};
                self.iot_boxes_save_orders = [];
                for (let i = 0; i < iot_boxes.length; i++) {
                    let iot_box = iot_boxes[i];
                    let iot_url = 'http://' + iot_box.proxy + ':' + iot_box.port;
                    self.iot_boxes_save_orders_by_id[iot_box['id']] = iot_box;
                    let iot_connection = new Session(void 0, iot_url, {
                        use_cors: true
                    });
                    self.iot_boxes_save_orders.push(iot_connection);
                }
                self._bind_iot();
            }
        }
    ]);
    let _super_PosModel = models.PosModel.prototype;
    models.PosModel = models.PosModel.extend({
        async automaticSetCoupon() {
            this.runningCouponProgram = true
            const selectedOrder = this.get_order();
            let lineAppliedCoupon = selectedOrder.orderlines.models.find(l => l.coupon_program_id != undefined)
            if (this.couponProgramsAutomatic && !lineAppliedCoupon) {
                this._autoRemoveCouponLines()
                for (let i = 0; i < this.couponProgramsAutomatic.length; i++) {
                    let couponProgram = this.couponProgramsAutomatic[i];
                    let rule = this.couponRule_by_id[couponProgram.rule_id[0]]
                    let reward = this.couponReward_by_id[couponProgram.reward_id[0]]
                    let canBeApplyCoupon = await this._checkCouponRule(couponProgram, null, rule, reward, true)
                    if (canBeApplyCoupon) {
                        this.db.notification('success', _t('Counpon Program: ') + couponProgram['name'] + _t(' Applied to order!!!'));
                        this._applyCouponReward(couponProgram, null, rule, reward);
                    }
                }
            }
            this.runningCouponProgram = false
        },

        _autoRemoveCouponLines() {
            const selectedOrder = this.get_order();
            selectedOrder.orderlines.models.forEach(l => {
                if (l.coupon_program_id) {
                    selectedOrder.remove_orderline(l)
                }
            })
            selectedOrder.orderlines.models.forEach(l => {
                if (l.coupon_program_id) {
                    selectedOrder.remove_orderline(l)
                }
            })
            selectedOrder.orderlines.models.forEach(l => {
                if (l.coupon_program_id) {
                    selectedOrder.remove_orderline(l)
                }
            })
        },

        async _applyCouponReward(program, coupon, rule, reward) {
            const selectedOrder = this.get_order();
            const product = this.db.get_product_by_id(reward.discount_line_product_id[0])
            if (!product) {
                this.db.notification('danger', reward.discount_line_product_id[1] + this.env._t(' not found. Can not apply reward'))
            }
            await this.rpc({
                model: 'product.product',
                method: 'force_write',
                args: [[reward.discount_line_product_id[0]], {
                    'available_in_pos': true
                }],
                context: {}
            })
            let balanceAmountCoupon;
            if (coupon) {
                let couponPrograms = await this.rpc({
                    model: 'coupon.coupon',
                    method: 'search_read',
                    domain: [['id', '=', coupon.id]],
                    fields: [],
                })
                coupon = couponPrograms[0]
                if (!['new', 'sent'].includes(coupon.state) || (coupon['is_gift_card'] && coupon['balance_amount'] <= 0)) {
                    return this.db.notification('danger', coupon.code + this.env._t(', This coupon has already been used or expired. Or Balance Amount is 0'))
                }
                if (coupon.is_gift_card) {
                    balanceAmountCoupon = coupon['balance_amount']
                }
            }
            await this.env.pos.sync_products_partners();
            let appliedRewardSuccessfully = false;
            if (reward.reward_type == 'discount') { // discount
                let price = 0;
                if (reward.discount_apply_on == 'on_order') { // discount apply on order
                    if (reward.discount_type == 'percentage') {
                        price = selectedOrder.get_total_with_tax() / 100 * reward.discount_percentage
                    } else {
                        price = reward.discount_fixed_amount
                    }
                    if (price > 0 && reward.discount_max_amount > 0 && price > reward.discount_max_amount) {
                        price = reward.discount_max_amount
                    }
                }
                if (reward.discount_apply_on == 'cheapest_product') { // discount apply on cheapest
                    let lineCheapest;
                    selectedOrder.orderlines.models.forEach(l => {
                        if (!lineCheapest || (lineCheapest && lineCheapest.get_price_with_tax() >= l.get_price_with_tax())) {
                            lineCheapest = l
                        }
                    })
                    if (reward.discount_type == 'percentage') {
                        price = lineCheapest.get_price_with_tax() / 100 * reward.discount_percentage
                    } else {
                        price = reward.discount_fixed_amount
                    }
                    if (price > 0 && reward.discount_max_amount > 0 && price > reward.discount_max_amount) {
                        price = reward.discount_max_amount
                    }
                }
                if (reward.discount_apply_on == 'specific_products') { // discount apply on specific products
                    selectedOrder.orderlines.models.forEach(l => {
                        if (reward.discount_specific_product_ids.includes(l.product.id)) {
                            price += l.get_price_with_tax()
                        }
                    })
                    if (reward.discount_type == 'percentage') {
                        price = price / 100 * reward.discount_percentage
                    } else {
                        price = reward.discount_fixed_amount
                    }
                    if (price > 0 && reward.discount_max_amount > 0 && price > reward.discount_max_amount) {
                        price = reward.discount_max_amount
                    }
                }
                let line = new models.Orderline({}, {
                    pos: this,
                    order: selectedOrder,
                    product: product
                });
                if (coupon) {
                    line.coupon_id = coupon.id
                }
                line.coupon_program_id = program.id
                line.coupon_program_name = program.name;
                line.price_manually_set = true; //no need pricelist change, price of promotion change the same, i blocked
                line.set_quantity(-1);
                if (selectedOrder.get_total_with_tax() <= price) {
                    price = selectedOrder.get_total_with_tax()
                }
                if (balanceAmountCoupon && price > balanceAmountCoupon) {
                    price = balanceAmountCoupon
                }
                line.set_unit_price(price);
                selectedOrder.orderlines.add(line);
                selectedOrder.trigger('change', selectedOrder)
                appliedRewardSuccessfully = true;
            } else { // free product
                const reward_product = this.db.get_product_by_id(reward.reward_product_id[0])
                let totalProductsMatchedRuleInCart = 0;
                selectedOrder.orderlines.models.forEach(l => {
                    if (rule.applied_product_ids.includes(l.product.id)) {
                        totalProductsMatchedRuleInCart += l.quantity
                    }
                })
                if (totalProductsMatchedRuleInCart >= rule.rule_min_quantity) {
                    let min_qty = rule.rule_min_quantity || 1
                    let quantity_free = parseInt(totalProductsMatchedRuleInCart / min_qty * reward.reward_product_quantity);
                    let line = new models.Orderline({}, {
                        pos: this,
                        order: selectedOrder,
                        product: reward_product
                    });
                    if (coupon) {
                        line.coupon_id = coupon.id
                    }
                    line.coupon_program_id = program.id
                    line.coupon_program_name = program.name
                    line.price_manually_set = true; //no need pricelist change, price of promotion change the same, i blocked
                    line.set_quantity(quantity_free);
                    line.set_unit_price(0);
                    selectedOrder.orderlines.add(line);
                    selectedOrder.trigger('change', selectedOrder)
                    appliedRewardSuccessfully = true
                }
            }
            return appliedRewardSuccessfully
        },

        async _checkCouponRule(program, coupon, rule, reward, automaticApplied) {
            console.log('[_checkCouponRule]: ' + program['name'])
            let passConditionOfProgram = true
            const rewardDroduct = this.db.get_product_by_id(reward.reward_product_id[0])
            const productDiscount = this.db.get_product_by_id(reward.discount_line_product_id[0])
            if (!rewardDroduct && reward.reward_type != 'discount') {
                await this.rpc({
                    model: 'product.product',
                    method: 'force_write',
                    args: [[reward.reward_product_id[0]], {
                        'available_in_pos': true
                    }],
                    context: {}
                })
                await this.env.pos.sync_products_partners();
            }
            if (!productDiscount && reward.reward_type == 'discount') {
                await this.rpc({
                    model: 'product.product',
                    method: 'force_write',
                    args: [[reward.discount_line_product_id[0]], {
                        'available_in_pos': true
                    }],
                    context: {}
                })
                await this.env.pos.sync_products_partners();
            }
            const selectedOrder = this.get_order()
            let client = selectedOrder.get_client()
            const currentTime = new Date().getTime()
            const productIdsInCart = selectedOrder.orderlines.models.map(l => l.product.id)
            const productIdsOfRuleExistInCart = rule.applied_product_ids.filter(product_id => productIdsInCart.includes(product_id) == true)
            let errorMessage;
            let couponPrograms = await this.rpc({
                model: 'coupon.program',
                method: 'search_read',
                domain: [['id', '=', program.id]],
                fields: ['pos_order_count', 'active'],
            })
            let totalAmountCompare = selectedOrder.get_total_with_tax();
            let totalTax = selectedOrder.get_total_tax();
            if (rule.rule_minimum_amount_tax_inclusion == "tax_excluded") {
                totalAmountCompare -= totalTax
            }
            if (rule.rule_minimum_amount > 0 && rule.rule_minimum_amount >= totalAmountCompare) {
                errorMessage = this.env._t('Promotion/Coupon have Minimum Purchase Amount Total of Order required bigger than ' + this.format_currency(rule.rule_minimum_amount))
                if (!automaticApplied) {
                    this.chrome.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: errorMessage
                    })
                }
                console.warn(errorMessage)
                passConditionOfProgram = false
            }
            if (rule.rule_min_quantity > 0) {
                let totalProductsMatchedRuleInCart = 0;
                selectedOrder.orderlines.models.forEach(l => {
                    if (rule.applied_product_ids.includes(l.product.id)) {
                        totalProductsMatchedRuleInCart += l.quantity
                    }
                })
                if (totalProductsMatchedRuleInCart < rule.rule_min_quantity) {
                    errorMessage = this.env._t('Products add to cart not matching with Products condition of Promotion. Minimum quantity is ' + rule.rule_min_quantity)
                    if (!automaticApplied) {
                        this.chrome.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: errorMessage
                        })
                    }
                    console.warn(errorMessage)
                    passConditionOfProgram = false
                }
            }
            if (coupon) {
                let coupons = await this.rpc({
                    model: 'coupon.coupon',
                    method: 'search_read',
                    domain: [['id', '=', coupon.id]],
                    fields: ['state', 'expiration_date'],
                })
                if (coupons.length == 0 || (coupons.length > 0 && !['new', 'sent'].includes(coupons[0]['state'])) || (coupons.length > 0 && new Date(coupons[0].expiration_date).getTime() < currentTime)) {
                    errorMessage = this.env._t('Coupon is expired or used before')
                    if (!automaticApplied) {
                        this.chrome.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: errorMessage
                        })
                    }
                    console.warn(errorMessage)
                    passConditionOfProgram = false
                }
            }
            if (rule.rule_date_from && new Date(rule.rule_date_from).getTime() > currentTime) {
                errorMessage = this.env._t('Start Date of Promotion/Coupon is: ') + rule.rule_date_from + this.env._t(' . Bigger than current Date Time')
                if (!automaticApplied) {
                    this.chrome.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: errorMessage
                    })
                }
                console.warn(errorMessage)
                passConditionOfProgram = false
            }
            if (rule.rule_date_to && new Date(rule.rule_date_to).getTime() < currentTime) {
                errorMessage = this.env._t('Promotion/Coupon Program is Expired at: ' + rule.rule_date_to)
                if (!automaticApplied) {
                    this.chrome.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: errorMessage
                    })
                }
                console.warn(errorMessage)
                passConditionOfProgram = false
            }
            if (program.program_type == 'promotion_program') {  // if promotion program, we required set client
                if (!client && rule.applied_partner_ids.length > 0) {
                    const {confirmed, payload: newClient} = await this.chrome.showTempScreen(
                        'ClientListScreen',
                        {client: null}
                    );
                    if (confirmed) {
                        selectedOrder.set_client(newClient);
                        client = newClient
                    } else {
                        errorMessage = this.env._t('Customer is Required')
                        if (!automaticApplied) {
                            this.chrome.showPopup('ErrorPopup', {
                                title: this.env._t('Error'),
                                body: errorMessage
                            })
                        }
                        console.warn(errorMessage)
                        passConditionOfProgram = false
                    }
                }
                if (rule.applied_partner_ids.length > 0 && client && !rule.applied_partner_ids.includes(client.id)) {
                    errorMessage = client.display_name + this.env._t(' not inside Based on Customers of Promotion/Coupon')
                    if (!automaticApplied) {
                        this.chrome.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: errorMessage
                        })
                    }
                    console.warn(errorMessage)
                    passConditionOfProgram = false
                }
            }
            if (!productIdsInCart) {
                errorMessage = this.env._t('Your cart is blank')
                if (!automaticApplied) {
                    this.chrome.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: errorMessage
                    })
                }
                console.warn(errorMessage)
                passConditionOfProgram = false
            }
            if (productIdsOfRuleExistInCart.length == 0 && rule.applied_product_ids.length != 0) {
                errorMessage = this.env._t('Products in cart not matching with Based on Products of Promotion/Coupon')
                if (!automaticApplied) {
                    this.alert_message({
                        title: this.env._t('Error'),
                        body: errorMessage
                    })
                }
                console.warn(errorMessage)
                passConditionOfProgram = false
            }
            if (program.maximum_use_number > 0) {
                if ((couponPrograms && couponPrograms['0']['pos_order_count'] >= program.maximum_use_number) || (couponPrograms && couponPrograms[0] && !couponPrograms[0]['active'])) {
                    errorMessage = this.env._t('Promotion/Coupon applied full ') + program.maximum_use_number + this.env._t(' POS Orders.')
                    if (!automaticApplied) {
                        this.alert_message({
                            title: this.env._t('Error'),
                            body: errorMessage
                        })
                    }
                    console.warn(errorMessage)
                    passConditionOfProgram = false
                }
            }
            return passConditionOfProgram
        },

        async getInformationCouponPromotionOfCode(code) {
            if (!this.couponProgram_by_code) {
                return true
            }
            let program = this.couponProgram_by_code[code];
            this._autoRemoveCouponLines()
            let coupon;
            let rule;
            let reward;
            if (program) {
                rule = this.couponRule_by_id[program.rule_id[0]]
                reward = this.couponReward_by_id[program.reward_id[0]]
            } else {
                coupon = this.coupon_by_code[code]
                if (coupon) {
                    program = this.couponProgram_by_id[coupon.program_id[0]]
                    rule = this.couponRule_by_id[program.rule_id[0]]
                    reward = this.couponReward_by_id[program.reward_id[0]]
                }

            }
            if (!program && !coupon) {
                return this.chrome.showPopup('ErrorPopup', {
                    title: this.env._t('Error'),
                    body: this.env._t('Coupon is not found. This coupon does not exist or expired or used before')
                })
            }
            if (program && rule && reward) {
                let canBeApplyCoupon = await this._checkCouponRule(program, coupon, rule, reward)
                if (canBeApplyCoupon) {
                    let hasAppliedCoupon = this._applyCouponReward(program, coupon, rule, reward);
                    if (hasAppliedCoupon) {
                        this.chrome.showPopup('ConfirmPopup', {
                            title: this.env._t('Coupon/Card is Correct'),
                            body: this.env._t('Couppon/Card : ') + program.name,
                            disableCancelButton: true,
                        })
                        return true
                    }
                }
            }
            return false
        },
        wrongInput(el, element) {
            $(el).find(element).css({
                'box-shadow': '0px 0px 0px 1px rgb(236, 5, 5) inset',
                'border': 'none !important',
                'border-bottom': '1px solid red !important'
            });
        },
        passedInput(el, element) {
            $(el).find(element).css({
                'box-shadow': '#3F51B5 0px 0px 0px 1px inset'
            })
        },
        _bind_iot: function () { // TODO: get notifications update from another sessions the same bus id
            // TODO: timeout 30 seconds, auto checking status of all pos boxes
            let self = this;
            for (let i = 0; i < this.iot_boxes_save_orders.length; i++) {
                let iot = this.iot_boxes_save_orders[i];
                iot.rpc('/pos/ping/server', {
                    ip: this.config.posbox_save_orders_server_ip,
                    port: this.config.posbox_save_orders_server_port
                }, {shadow: true, timeout: 2500}).then(function (result) {
                    let value = JSON.parse(result);
                    let response_ping_odoo_server = value.values;
                    if (!response_ping_odoo_server) {
                        self.set('synch', {status: 'disconnected', pending: 'Fail Connect POSBOX'});
                        self.chrome.showPopup('ErrorPopup', {
                            title: _t('Warning'),
                            body: _t('Odoo server down or network PosBox have problem, IoT could not ping to your Odoo with ip ' + self.config.posbox_save_orders_server_ip + ' and port:' + self.config.posbox_save_orders_server_port)
                        })
                    } else {
                        console.log('Ping Odoo server IP: http://' + self.config.posbox_save_orders_server_ip + ':8069 from IoT succeed')
                    }
                }).catch(function (error) {
                    self.chrome.showPopup('ErrorPopup', {
                        title: _t('Save Orders Offline mode is Error'),
                        body: _t('Could not connecting POSBOX IP Address ') + self.config.posbox_save_orders_server_ip + ('. Please checking Save Order Offline of POS Setting')
                    })
                });
                iot.rpc('/pos/push/orders', {
                    database: this.session.db,
                }, {shadow: true, timeout: 65000}).then(function (result) {
                    console.log('Result of Call IoT Box push orders to Odoo Server: ' + result)
                    self.set('synch', {status: 'connected', pending: 'Saved Orders on POSBOX'});
                }).catch(function (error) {
                    self.set('synch', {status: 'disconnected', pending: 'Fail Connect POSBOX'});
                    console.log(error)
                })
            }
            setTimeout(_.bind(this._bind_iot, this), 5000);
        },
        reload_pos: function () {
            location.reload();
        },
        close_pos: function () {
            window.location = '/web#action=point_of_sale.action_client_pos_menu';
        },
        _flush_orders: function (orders, options) {
            // TODO: this is test case push 500 orders / current time
            let self = this;
            if (this.iot_boxes_save_orders) {
                if (orders.length) {
                    console.log('[_flush_orders] to posbox ' + orders.length)
                    for (let i = 0; i < this.iot_boxes_save_orders.length; i++) {
                        this.iot_boxes_save_orders[i].rpc("/pos/save/orders", {
                            database: this.session.db,
                            orders: orders,
                            url: 'http://' + this.config.posbox_save_orders_server_ip + ':' + this.config.posbox_save_orders_server_port + '/pos/create_from_ui',
                            username: this.session.username,
                            server_version: this.session.server_version,

                        }, {shadow: true, timeout: 7500}).then(function (results) {
                            let order_ids = JSON.parse(results)['order_ids'];
                            for (let i = 0; i < order_ids.length; i++) {
                                self.db.remove_order(order_ids[i]);
                                self.set('failed', false);
                            }
                            return order_ids
                        }).catch(function (reason) {
                            self.set_synch(self.get('failed') ? 'error' : 'disconnected');
                            return Promise.reject(error);
                        });
                    }
                }
                return Promise.resolve([]);
            } else {
                return _super_PosModel._flush_orders.apply(this, arguments)
            }
        },
        get_picking_source_location: function () {
            let stock_location_id = this.config.stock_location_id;
            let selected_order = this.get_order();
            if (selected_order && selected_order.location) {
                return selected_order.location;
            } else {
                return this.stock_location_by_id[stock_location_id[0]];
            }
        },
        get_all_source_locations: function () {
            if (this.stock_location_ids.length != 0) {
                return this.stock_location_ids.concat(this.config.stock_location_id[0])
            } else {
                return [this.config.stock_location_id[0]]
            }
        },
        generate_wrapped_name: function (name) {
            let MAX_LENGTH = 24; // 40 * line ratio of .6
            let wrapped = [];
            let current_line = "";

            while (name.length > 0) {
                let space_index = name.indexOf(" ");

                if (space_index === -1) {
                    space_index = name.length;
                }

                if (current_line.length + space_index > MAX_LENGTH) {
                    if (current_line.length) {
                        wrapped.push(current_line);
                    }
                    current_line = "";
                }

                current_line += name.slice(0, space_index + 1);
                name = name.slice(space_index + 1);
            }

            if (current_line.length) {
                wrapped.push(current_line);
            }

            return wrapped;
        },
        highlight_control_button: function (button_class) {
            $('.' + button_class).addClass('highlight')
        },
        remove_highlight_control_button: function (button_class) {
            $('.' + button_class).removeClass('highlight')
        },
        async show_purchased_histories(client) {
            let self = this;
            if (!client) {
                client = this.get_client();
            }
            if (!client) {
                this.alert_message({
                    title: 'Warning',
                    body: 'We could not find purchased orders histories, please set client first'
                });
                this.gui.show_screen('clientlist')
            } else {
                let orders = this.db.get_pos_orders().filter(function (order) {
                    return order.partner_id && order.partner_id[0] == client['id']
                });
                if (orders.length) {
                    const {confirmed, payload: result} = await this.showTempScreen(
                        'PosOrderScreen',
                        {
                            order: null,
                            selectedClient: client
                        }
                    );
                } else {
                    this.chrome.showPopup('ErrorPopup', {
                        title: 'Warning',
                        body: 'Your POS not active POS Order Management or Current Client have not any Purchased Orders'
                    })
                }
            }
        },
        _get_stock_on_hand_by_location_ids: async function (product_ids = [], location_ids = []) {
            return await rpc.query({
                model: 'stock.location',
                method: 'get_stock_data_by_location_ids',
                args: [[], product_ids, location_ids],
                context: {}
            }, {
                shadow: true,
                timeout: 65000
            });
        },
        _get_voucher_number: function () {
            let self = this;
            return new Promise(function (resolve, reject) {
                return rpc.query({
                    model: 'pos.config',
                    method: 'get_voucher_number',
                    args: [[], self.config.id],
                    context: {}
                }).then(function (number) {
                    resolve(number)
                }, function (err) {
                    reject(err)
                })
            })
        },
        show_products_with_field: function (field) {
            let products = this.db.get_all_products();
            let products_by_field = _.filter(products, function (product) {
                return product[field] == true;
            });
            if (products_by_field.length != 0) {
                this.gui.screen_instances.products.product_list_widget.set_product_list(products_by_field);
            }
        },
        show_products_type_only_product: function () {
            let products = this.db.get_all_products();
            let products_type_product = _.filter(products, function (product) {
                return product.type == 'product';
            });
            this.gui.screen_instances.products.product_list_widget.set_product_list(products_type_product);
        },
        _do_update_quantity_onhand: async function (product_ids) {
            const self = this;
            if (!this.config.display_onhand) {
                return
            }
            let location_selected = this.get_picking_source_location();
            console.log('[_do_update_quantity_onhand] of Location: ' + location_selected.name);
            if (product_ids.length == 0) {
                let products = this.db.get_all_products();
                let productsHasStoreAble = _.filter(products, function (product) {
                    return product.type == 'product';
                });
                if (productsHasStoreAble.length) {
                    const maxLoad = 500;
                    for (let i = 0; i < productsHasStoreAble.length; i++) {
                        let p = productsHasStoreAble[i];
                        if (i <= maxLoad) {
                            product_ids.push(p.id)
                        } else {
                            break
                        }
                    }
                }
            }
            if (product_ids.length == 0) {
                return true
            }
            const stock_datas = await this._get_stock_on_hand_by_location_ids(product_ids, [location_selected.id])
            let products = [];
            let datas = stock_datas[this.get_picking_source_location().id];
            if (!datas) {
                return;
            }
            for (let product_id in datas) {
                let product = this.db.product_by_id[parseInt(product_id)];
                if (product) {
                    products.push(product);
                    let qty_available = datas[product_id];
                    try {
                        this.db.stock_datas[product['id']] = qty_available;
                    } catch (ex) {
                        debugger
                    }
                }
            }
            // if (products.length) {
            //     this.trigger('product.updated')
            // }
            this.product_ids_need_update_stock = [];
        },
        async _validate_action(title) {
            let validate = await this._validate_by_manager(title);
            if (!validate) {
                this.chrome.showPopup('ErrorPopup', {
                    title: this.env._t('Validation Failed !!!'),
                    body: this.env._t(
                        'Your Action required Approve by Your Manager'
                    ),
                });
                return false;
            }
            return true
        },
        async _validate_by_manager(title) {
            if (!this.chrome) {
                return true
            }
            let self = this;
            let manager_validate = [];
            _.each(this.config.manager_ids, function (user_id) {
                let user = self.user_by_id[user_id];
                if (user) {
                    manager_validate.push({
                        id: user.id,
                        label: user.name,
                        item: user,
                        imageUrl: 'data:image/png;base64, ' + user['image_1920'],
                    })
                }
            });
            if (manager_validate.length == 0) {
                this.chrome.showPopup('ErrorPopup', {
                    title: this.env._t('Error'),
                    body: this.env._t('Your POS Setting / Tab Security not set Managers Approve'),
                    disableCancelButton: true,
                })
                return false
            }
            let popup_title = this.env._t('Select one ');
            if (title) {
                popup_title += ' : ' + title;
            }
            if (manager_validate.length > 1) {
                let {confirmed, payload: selected_user} = await this.chrome.showPopup('SelectionPopup', {
                    title: popup_title,
                    list: manager_validate,
                })
                if (confirmed) {
                    let manager_user = selected_user;
                    let {confirmed, payload: password} = await self.chrome.showPopup('NumberPopup', {
                        title: _t('Dear:  ') + manager_user.name + this.env._t('. Can you input your POS Pass Pin for validate this Action of ') + this.user.name,
                        isPassword: true,
                        allowScanBarcode: true,
                    });
                    if (confirmed) {
                        if (manager_user['pos_security_pin'] != password) {
                            this.alert_message({
                                title: _t('Warning'),
                                body: _t('Pos Security Pin of ') + manager_user.name + _t(' Incorrect.')
                            })
                            return self._validate_by_manager(title)
                        } else {
                            return true
                        }
                    } else {
                        return false
                    }
                } else {
                    return false
                }
            } else {
                let manager_user = manager_validate[0]['item'];
                let {confirmed, payload: password} = await self.chrome.showPopup('NumberPopup', {
                    title: _t('Dear:  ') + manager_user.name + this.env._t('. Can you input your POS Pass Pin for validate this Action of ') + this.user.name,
                    isPassword: true,
                    allowScanBarcode: true,
                });
                if (confirmed) {
                    if (manager_user['pos_security_pin'] != password) {
                        this.alert_message({
                            title: _t('Warning'),
                            body: _t('Pos Security Pin of ') + manager_user.name + _t(' Incorrect.')
                        })
                        return self._validate_by_manager(title)
                    } else {
                        return true
                    }
                } else {
                    return false
                }
            }
        },
        _search_read_by_model_and_id: function (model, ids) {
            let object = this.get_model(model);
            return new Promise(function (resolve, reject) {
                rpc.query({
                    model: model,
                    method: 'search_read',
                    domain: [['id', 'in', ids]],
                    fields: object.fields
                }, {
                    timeout: 30000,
                    shadow: true,
                }).then(function (datas) {
                    resolve(datas)
                }, function (error) {
                    reject(error)
                })
            })
        },
        _update_cart_qty_by_order: function (product_ids) {
            let selected_order = this.get_order();
            $('.cart_qty').addClass('oe_hidden');
            let product_quantity_by_product_id = selected_order.product_quantity_by_product_id();
            for (let i = 0; i < selected_order.orderlines.models.length; i++) {
                let line = selected_order.orderlines.models[i];
                let product_id = line.product.id;
                let $qty = $('article[data-product-id="' + product_id + '"] .cart_qty');
                let qty = product_quantity_by_product_id[product_id];
                if (qty) {
                    $qty.removeClass('oe_hidden');
                    $('article[data-product-id="' + product_id + '"] .add_shopping_cart').html(qty);
                } else {
                    $qty.addClass('oe_hidden');
                }
            }
            let total_items = selected_order.get_total_items();
            $('.items-incart').text(total_items);
        },
        _get_active_pricelist: function () {
            let current_order = this.get_order();
            let default_pricelist = this.default_pricelist;
            if (current_order && current_order.pricelist) {
                let pricelist = _.find(this.pricelists, function (pricelist_check) {
                    return pricelist_check['id'] == current_order.pricelist['id']
                });
                return pricelist;
            } else {
                if (default_pricelist) {
                    let pricelist = _.find(this.pricelists, function (pricelist_check) {
                        return pricelist_check['id'] == default_pricelist['id']
                    });
                    return pricelist
                } else {
                    return null
                }
            }
        },
        set_cashier: function (employee) {
            _super_PosModel.set_cashier.apply(this, arguments);
            if (employee.is_employee && this.chrome && this.chrome.env && this.chrome.env.qweb) {
                this.config.allow_discount = employee['allow_discount']
                this.config.allow_qty = employee['allow_qty']
                this.config.allow_price = employee['allow_price']
                this.config.allow_remove_line = employee['allow_remove_line']
                this.config.allow_minus = employee['allow_minus']
                this.config.allow_payment = employee['allow_payment']
                this.config.allow_customer = employee['allow_customer']
                this.config.allow_add_order = employee['allow_add_order']
                this.config.allow_remove_order = employee['allow_remove_order']
                this.config.allow_add_product = employee['allow_add_product']
                this.config.allow_payment_zero = employee['allow_payment_zero']
                this.chrome.env.qweb.forceUpdate();
            }
        },
        _get_default_pricelist: function () {
            let current_pricelist = this.default_pricelist;
            return current_pricelist
        },
        get_model: function (_name) {
            let _index = this.models.map(function (e) {
                return e.model;
            }).indexOf(_name);
            if (_index > -1) {
                return this.models[_index];
            }
            return false;
        },
        initialize: function (session, attributes) {
            this.is_mobile = odoo.is_mobile;
            let loyalty_rule_model = this.get_model('loyalty.rule');
            if (loyalty_rule_model) {
                loyalty_rule_model.condition = function (self) {
                    if (self.config.pos_loyalty_id) {
                        return false
                    } else {
                        if (self.config.module_pos_loyalty && self.config.loyalty_id) {
                            return true
                        } else {
                            return false
                        }
                    }
                }
            }
            let loyalty_reward_model = this.get_model('loyalty.reward');
            if (loyalty_reward_model) {
                loyalty_reward_model.condition = function (self) {
                    if (self.config.pos_loyalty_id) {
                        return false
                    } else {
                        if (self.config.module_pos_loyalty && self.config.loyalty_id) {
                            return true
                        } else {
                            return false
                        }
                    }
                }
            }
            let account_tax_model = this.get_model('account.tax');
            account_tax_model.fields.push('type_tax_use');
            let wait_currency = this.get_model('res.currency');
            wait_currency.fields.push(
                'rate'
            );
            let account_fiscal_position_tax_model = this.get_model('account.fiscal.position.tax');
            let _super_account_fiscal_position_tax_model_loaded = account_fiscal_position_tax_model.loaded;
            account_fiscal_position_tax_model.loaded = function (self, fiscal_position_taxes) {
                fiscal_position_taxes = _.filter(fiscal_position_taxes, function (tax) {
                    return tax.tax_dest_id != false;
                });
                if (fiscal_position_taxes.length > 0) {
                    _super_account_fiscal_position_tax_model_loaded(self, fiscal_position_taxes);
                }
            };
            let pos_category_model = this.get_model('pos.category');
            pos_category_model.condition = function (self) {
                return self.config.product_category_ids.length == 0
            }
            let _super_loaded_pos_category_model = pos_category_model.loaded;
            pos_category_model.loaded = function (self, categories) {
                if (!self.pos_categories) {
                    self.pos_categories = categories;
                    self.pos_category_by_id = {};
                } else {
                    self.pos_categories = self.pos_categories.concat(categories);
                }
                for (let i = 0; i < categories.length; i++) {
                    let category = categories[i];
                    self.pos_category_by_id[category.id] = category;
                }
                _.each(categories, function (category) {
                    category.parent = self.pos_category_by_id[category.parent_id[0]];
                });
                _super_loaded_pos_category_model(self, categories);
            };
            pos_category_model.fields = pos_category_model.fields.concat([
                'is_category_combo',
                'sale_limit_time',
                'from_time',
                'to_time',
                'submit_all_pos',
                'pos_branch_ids',
                'pos_config_ids',
                'category_type',
            ]);

            let product_category_model = this.get_model('product.category');
            product_category_model.domain = function (self) {
                if (self.config.product_category_ids) {
                    return [['id', 'in', self.config.product_category_ids]]
                } else {
                    return []
                }
            }
            let _super_loaded_product_category_model = product_category_model.loaded;
            product_category_model.loaded = function (self, categories) {
                self.pos_categories_appetizer = []
                if (!self.pos_categories) {
                    self.pos_categories = categories;
                    self.pos_category_by_id = {};
                } else {
                    self.pos_categories = self.pos_categories.concat(categories);
                }
                for (let i = 0; i < categories.length; i++) {
                    let category = categories[i];
                    self.pos_category_by_id[category.id] = category;
                    if (category['category_type'] == 'appetizer') {
                        self.pos_categories_appetizer.push(category.id)
                    }
                }
                _.each(categories, function (category) {
                    category.parent = self.pos_category_by_id[category.parent_id[0]];
                });
                _super_loaded_product_category_model(self, categories);
                self.db.add_categories(categories);
            };
            let product_model = this.get_model('product.product');
            product_model.fields.push(
                'name',
                'is_credit',
                'multi_category',
                'multi_uom',
                'multi_variant',
                'supplier_barcode',
                'is_combo',
                'sale_ok',
                'combo_limit',
                'uom_po_id',
                'barcode_ids',
                'pos_categ_ids',
                'supplier_taxes_id',
                'volume',
                'weight',
                'description_sale',
                'description_picking',
                'type',
                'cross_selling',
                'standard_price',
                'pos_sequence',
                'is_voucher',
                'minimum_list_price',
                'sale_with_package',
                'qty_warning_out_stock',
                'write_date',
                'is_voucher',
                'combo_price',
                'is_combo_item',
                'name_second',
                'note_ids',
                'tag_ids',
                'commission_rate',
                'company_id',
                'uom_ids',
                'attribute_line_ids',
                'product_template_attribute_value_ids',
                'addon_id',
                'college_id',
                'model_id',
                'sex_id',
                'discountable',
                'refundable',
            );
            this.bus_location = null;
            let partner_model = this.get_model('res.partner');
            partner_model.fields.push(
                'display_name',
                'ref',
                'vat',
                'comment',
                'discount_id',
                'credit',
                'debit',
                'balance',
                'limit_debit',
                'wallet',
                'property_product_pricelist',
                'property_payment_term_id',
                'is_company',
                'write_date',
                'birthday_date',
                'group_ids',
                'title',
                'company_id',
                'pos_loyalty_point',
                'pos_loyalty_type',
                'pos_order_count',
                'pos_total_amount',
                'type',
                'parent_id',
                'company_type',
                'active',
            );
            const productAttributeModel = this.get_model('product.attribute');
            if (productAttributeModel) {
                productAttributeModel.domain = []
            }
            let pricelist_model = this.get_model('product.pricelist');
            pricelist_model.fields.push('id', 'currency_id');
            pricelist_model['pricelist'] = true;
            let _super_pricelist_loaded = pricelist_model.loaded;
            pricelist_model.loaded = function (self, pricelists) {
                self.pricelist_currency_ids = [];
                self.pricelist_by_id = {};
                for (let i = 0; i < pricelists.length; i++) {
                    let pricelist = pricelists[i];
                    if (pricelist.currency_id) {
                        pricelist.name = pricelist.name + '(' + pricelist.currency_id[1] + ')'
                    }
                    self.pricelist_by_id[pricelist.id] = pricelist;
                    if (pricelist.currency_id) {
                        self.pricelist_currency_ids.push(pricelist.currency_id[0])
                    }
                }
                _super_pricelist_loaded(self, pricelists);
            };
            let pricelist_item_model = this.get_model('product.pricelist.item');
            pricelist_item_model['pricelist'] = true;
            let payment_method_object = this.get_model('pos.payment.method');
            let _super_payment_method_loaded = payment_method_object.loaded;
            payment_method_object.fields = payment_method_object.fields.concat([
                'cash_journal_id',
                'fullfill_amount',
                'shortcut_keyboard',
                'cheque_bank_information',
                'is_pax',
                'pax_id',
            ]);
            payment_method_object.loaded = function (self, payment_methods) {
                self.payment_methods = payment_methods;
                _super_payment_method_loaded(self, payment_methods);
            };
            let res_users_object = this.get_model('res.users');
            if (res_users_object) {
                res_users_object.fields = res_users_object.fields.concat([
                    'pos_security_pin',
                    'barcode',
                    'pos_config_id',
                    'partner_id',
                    'company_ids',
                ]);
                // todo: move load res.users after pos.config, we dont want load res.users after partners or products because we need checking company_ids of user
                let res_users = _.filter(this.models, function (model) {
                    return model.model == 'res.users';
                });
                this.models = _.filter(this.models, function (model) {
                    return model.model != 'res.users';
                })
                if (res_users) {
                    let index_number_pos_config = null;
                    for (let i = 0; i < this.models.length; i++) {
                        let model = this.models[i];
                        if (model.model == 'pos.config') {
                            index_number_pos_config = i;
                            break
                        }
                    }
                    for (let i = 0; i < res_users.length; i++) {
                        let user_model = res_users[i];
                        this.models.splice(index_number_pos_config + 1, 0, user_model)
                    }
                }
            }
            let pos_session_model = this.get_model('pos.session');
            pos_session_model.fields.push('lock_state');
            let pos_config_model = this.get_model('pos.config');
            let _pos_config_loaded = pos_config_model.loaded;
            pos_config_model.loaded = function (self, configs) {
                _pos_config_loaded(self, configs);
                self.config.sync_to_pos_config_ids = _.filter(self.config.sync_to_pos_config_ids, function (id) {
                    return id != self.config.id
                })
            };
            _super_PosModel.initialize.apply(this, arguments);
            let employee_model = this.get_model('hr.employee');
            if (employee_model) {
                let _super_employee_model_loaded = employee_model.loaded;
                employee_model.fields = employee_model.fields.concat([
                    'allow_discount',
                    'allow_qty',
                    'allow_price',
                    'allow_remove_line',
                    'allow_minus',
                    'allow_payment',
                    'allow_customer',
                    'allow_add_order',
                    'allow_remove_order',
                    'allow_add_product',
                    'allow_payment_zero',
                    'image_1920',
                ])
                employee_model.loaded = function (self, employees) {
                    _super_employee_model_loaded(self, employees);
                    self.employee_by_id = {};
                    for (let i = 0; i < employees.length; i++) {
                        let emp = employees[i];
                        self.employee_by_id[emp.id] = emp;
                    }
                };
            }
        },
        async _required_set_client() {
            let order = this.get_order();
            let client = order.get_client();
            if (!client && this.config.add_customer_before_products_already_in_shopping_cart && this.chrome) {
                const {confirmed, payload: newClient} = await this.chrome.showTempScreen(
                    'ClientListScreen',
                    {client: null}
                );
                if (confirmed) {
                    order.set_client(newClient);
                } else {
                    this.chrome.showPopup('ErrorPopup', {
                        title: this.env._t('Warning !!! Your POS Active set Customer before add items to Cart'),
                        body: this.env._t('Please select one Customer before add items to cart')
                    })
                    return this._required_set_client()
                }
            }
            return true
        },
        async add_new_order() {
            _super_PosModel.add_new_order.apply(this, arguments);
            const order = this.get_order();
            const client = order.get_client();
            if (!client && this.config.customer_default_id) {
                let client_default = this.db.get_partner_by_id(this.config.customer_default_id[0]);
                if (!client_default) {
                    this.chrome.showPopup('ErrorPopup', {
                        title: this.env._t('Warning !!!'),
                        body: this.config.customer_default_id[1] + this.env._t(' set to Default Customer of new Order, but it Arichived it. Please Unarchive')
                    })
                } else {
                    order.set_client(client_default);
                }
            }
            this._required_set_client()
        },
        formatDateTime: function (value, field, options) {
            if (value === false) {
                return "";
            }
            if (!options || !('timezone' in options) || options.timezone) {
                value = value.clone().add(session.getTZOffset(value), 'minutes');
            }
            return value.format(time.getLangDatetimeFormat());
        },
        format_date: function (date) { // covert datetime backend to pos
            if (date) {
                return this.formatDateTime(
                    moment(date), {}, {timezone: true});
            } else {
                return ''
            }
        },
        get_config: function () {
            return this.config;
        },
        get_packaging_by_product: function (product) {
            if (!this.packaging_by_product_id || !this.packaging_by_product_id[product.id]) {
                return false;
            } else {
                return true
            }
        },
        get_default_sale_journal: function () {
            let invoice_journal_id = this.config.invoice_journal_id;
            if (!invoice_journal_id) {
                return null
            } else {
                return invoice_journal_id[0];
            }
        },
        get_bus_location: function () {
            return this.bus_location
        },
        alert_message: function (options) {
            let from = options['from'] || 'right';
            let align = options['align'] || 'top';
            let title = options['title'] || 'Message'
            let timer = options['timer'] || 500;
            let color = options['color'] || 'danger'
            let body = options.body || ''
            try {
                $.notify({
                    icon: "notifications",
                    message: "<b>" + title + "</b> - " + body

                }, {
                    type: color,
                    timer: timer,
                    placement: {
                        from: from,
                        align: align
                    }
                });
            } catch (e) {
                this.chrome.props.webClient.do_warn(title, body, true)
            }
        },
        query_backend_fail: function (error) {
            if (error && error.message && error.message.code && error.message.code == 200) {
                return this.chrome.showPopup('ConfirmPopup', {
                    title: error.message.code,
                    body: error.message.data.message,
                    disableCancelButton: true,
                })
            }
            if (error && error.message && error.message.code && error.message.code == -32098) {
                return this.chrome.showPopup('ConfirmPopup', {
                    title: error.message.code,
                    body: 'Your Odoo Server Offline',
                    disableCancelButton: true,
                })
            } else {
                return this.chrome.showPopup('ConfirmPopup', {
                    title: 'Error',
                    body: 'Odoo offline mode or backend codes have issues. Please contact your admin system',
                    disableCancelButton: true,
                })
            }
        }
        ,
        async scan_product(parsed_code) {
            /*
                    This function only return true or false
                    Because if barcode passed mapping data of products, customers ... will return true
                    Else all return false and popup warning message
             */
            let self = this;
            posbus.trigger('scan.barcode.validate.badgeID', parsed_code.code)
            const barcodeScanned = parsed_code.code
            if (this.validate_manager) {
                this.validate_manager = false
                return true
            }
            console.log('-> [scan barcode]' + parsed_code.code);
            console.clear();
            const product = this.db.get_product_by_barcode(parsed_code.code);
            let lots = this.lots.filter(l => l.barcode == parsed_code.code || l.name == parsed_code.code);
            const selectedOrder = this.get_order();
            let products_by_supplier_barcode = this.db.product_by_supplier_barcode[parsed_code.code];
            let barcodes = this.barcodes_by_barcode[parsed_code.code];
            lots = _.filter(lots, function (lot) {
                let product_id = lot.product_id[0];
                let product = self.db.product_by_id[product_id];
                return product != undefined
            });
            // scan barcode of packaging, auto fill quantity of pack
            let productQuantityPacks = this.packagings.filter(pack => pack.barcode == barcodeScanned)
            if (productQuantityPacks.length) {
                let list = productQuantityPacks.map(pack => ({
                    label: pack.name + this.env._t(' with barcode ' + pack.barcode),
                    item: pack,
                    id: pack.id
                }));
                let {confirmed, payload: packSelected} = await this.chrome.showPopup('SelectionPopup', {
                    title: _t('Select one Product Packaging'),
                    list: list,
                });
                if (confirmed) {
                    let productOfPack = this.db.product_by_id[packSelected.product_id[0]];
                    if (productOfPack) {
                        selectedOrder.add_product(productOfPack, {quantity: packSelected.qty, merge: false});
                        let order_line = selectedOrder.get_selected_orderline();
                        order_line.price_manually_set = true;
                        if (packSelected.list_price > 0) {
                            order_line.set_unit_price(packSelected['list_price']);
                        }
                        return true
                    }
                }
            }
            // scan lots
            if (lots && lots.length) {
                const list = lots.map(l => (
                    {
                        label: _t('Lot Name: ') + l.name + _t(' with quantity ') + l.product_qty,
                        item: l,
                        id: l.id
                    }
                ))
                let {confirmed, payload: lot} = await this.chrome.showPopup('SelectionPopup', {
                    title: _t('Select one Lot Serial'),
                    list: list,
                });
                if (confirmed) {
                    let productOfLot = this.db.product_by_id[lot.product_id[0]];
                    if (productOfLot) {
                        selectedOrder.add_product(productOfLot, {merge: false});
                        let order_line = selectedOrder.get_selected_orderline();
                        if (order_line) {
                            if (lot.replace_product_public_price && lot.public_price) {
                                order_line.set_unit_price(lot['public_price'])
                                order_line.price_manually_set = true;
                            }
                            const modifiedPackLotLines = {}
                            const newPackLotLines = [{
                                lot_name: lot.name
                            }]
                            order_line.setPackLotLines({modifiedPackLotLines, newPackLotLines});
                        }
                        return true
                    }
                }
            }

            // scan supplier barcode
            if (products_by_supplier_barcode) {
                let list = products_by_supplier_barcode.map(p => ({
                    id: p.id,
                    label: p.display_name,
                    item: p

                }))
                if (product) {
                    list.push({
                        id: product.id,
                        label: product.display_name,
                        item: product
                    })
                }
                let {confirmed, payload: productSelected} = await this.chrome.showPopup('SelectionPopup', {
                    title: _t('Select one product'),
                    list: list,
                });
                if (confirmed) {
                    if (parsed_code.type === 'price') {
                        selectedOrder.add_product(productSelected, {
                            quantity: 1,
                            price: product['lst_price'],
                            merge: true
                        });
                    } else if (parsed_code.type === 'weight') {
                        selectedOrder.add_product(productSelected, {
                            quantity: 1,
                            price: product['lst_price'],
                            merge: false
                        });
                    } else if (parsed_code.type === 'discount') {
                        selectedOrder.add_product(productSelected, {discount: parsed_code.value, merge: false});
                    } else {
                        selectedOrder.add_product(productSelected);
                    }
                    return true
                }
            }
            // scan via multi barcode
            if (!product && barcodes) { // not have product but have barcodes
                let list = barcodes.map(b => ({
                    id: b.id,
                    item: b,
                    label: b.product_id[1] + this.env._t(' with Units: ') + b.uom_id[1]
                }));
                let {confirmed, payload: barcodeSelected} = await this.chrome.showPopup('SelectionPopup', {
                    title: _t('Select Product add to Cart'),
                    list: list,
                })
                if (confirmed) {
                    let productOfBarcode = self.db.product_by_id[barcodeSelected['product_id'][0]];
                    if (productOfBarcode) {
                        let pricelist_id = barcodeSelected.pricelist_id[0];
                        let pricelist = this.pricelist_by_id[pricelist_id];
                        if (pricelist) {
                            selectedOrder.set_pricelist(pricelist)
                        }
                        selectedOrder.add_product(productOfBarcode, {
                            quantity: 1,
                            extras: {
                                uom_id: barcodeSelected['uom_id'][0]
                            }
                        });
                        let uom_id = barcodeSelected.uom_id[0];
                        let uom = this.uom_by_id[uom_id];
                        if (uom && selectedOrder.pricelist) {
                            let price = productOfBarcode.get_price(product, selectedOrder.pricelist, 1, uom_id);
                            selectedOrder.selected_orderline.set_unit(uom_id, price)
                        }
                        return true
                    }
                }
            }
            const resultOfCore = _super_PosModel.scan_product.apply(this, arguments);
            // voucher
            if (!product && barcodeScanned) {
                let voucher = await this.rpc({
                    model: 'pos.voucher',
                    method: 'get_voucher_by_code',
                    args: [barcodeScanned],
                })
                if (voucher != -1) {
                    selectedOrder.client_use_voucher(voucher)
                    return true
                }
            }
            if (!resultOfCore) {
                const orderReturn = this.env.pos.db.get_pos_orders().find(o => o.ean13 == barcodeScanned)
                if (orderReturn) {
                    const {confirmed, payload: result} = await this.chrome.showTempScreen(
                        'PosOrderScreen',
                        {
                            order: orderReturn,
                            selectedClient: null
                        }
                    );
                    return true
                }
                const scanCoupon = this.getInformationCouponPromotionOfCode(barcodeScanned)
                if (!scanCoupon) {
                    this.chrome.showPopup('ErrorPopup', {
                        title: this.env._t('Unknow Barcode'),
                        body: this.env._t('We not found any item with barcode: ' + barcodeScanned)
                    })
                }

            }
            return resultOfCore
        },
        get_image_url_by_model: function (record, model) {
            return window.location.origin + '/web/image?model=' + model + '&field=image_128&id=' + record.id;
        },
        async buildReport(report_html) {
            const printer = new Printer();
            const ticketImage = await printer.htmlToImg(report_html);
            return 'data:image/png;base64,' + ticketImage
        },

        getReceiptEnv() {
            let selectedOrder = this.get_order();
            if (!selectedOrder) {
                return null
            }
            let receiptEnv = selectedOrder.getOrderReceiptEnv();
            receiptEnv['pos'] = this;
            if (this.company.contact_address) {
                receiptEnv.receipt.contact_address = this.company.contact_address
            }
            let orderlines_by_category_name = {};
            let order = this.get_order();
            let orderlines = order.orderlines.models;
            let categories = [];
            if (this.config.category_wise_receipt) {
                for (let i = 0; i < orderlines.length; i++) {
                    let line = orderlines[i];
                    let line_print = line.export_for_printing();
                    line['product_name_wrapped'] = line_print['product_name_wrapped'][0];
                    let pos_categ_id = line['product']['pos_categ_id'];
                    if (pos_categ_id && pos_categ_id.length == 2) {
                        let root_category_id = order.get_root_category_by_category_id(pos_categ_id[0]);
                        let category = this.db.category_by_id[root_category_id];
                        let category_name = category['name'];
                        if (!orderlines_by_category_name[category_name]) {
                            orderlines_by_category_name[category_name] = [line];
                            let category_index = _.findIndex(categories, function (category) {
                                return category == category_name;
                            });
                            if (category_index == -1) {
                                categories.push(category_name)
                            }
                        } else {
                            orderlines_by_category_name[category_name].push(line)
                        }

                    } else {
                        if (!orderlines_by_category_name['None']) {
                            orderlines_by_category_name['None'] = [line]
                        } else {
                            orderlines_by_category_name['None'].push(line)
                        }
                        let category_index = _.findIndex(categories, function (category) {
                            return category == 'None';
                        });
                        if (category_index == -1) {
                            categories.push('None')
                        }
                    }
                }
            }
            receiptEnv['orderlines_by_category_name'] = orderlines_by_category_name;
            receiptEnv['categories'] = categories;
            receiptEnv['total_paid'] = order.get_total_paid(); // save amount due if have (display on receipt of partial order)
            receiptEnv['total_due'] = order.get_due(); // save amount due if have (display on receipt of partial order)
            receiptEnv['invoice_ref'] = order.invoice_ref;
            receiptEnv['picking_ref'] = order.picking_ref;
            receiptEnv['order_fields_extend'] = order.order_fields_extend;
            receiptEnv['delivery_fields_extend'] = order.delivery_fields_extend;
            receiptEnv['invoice_fields_extend'] = order.invoice_fields_extend;
            return receiptEnv
        },
        _get_voucher_env: function (voucher) {
            let cashier = this.get_cashier();
            let company = this.company;
            return {
                widget: this,
                pos: this,
                cashier: cashier,
                company: company,
                voucher: voucher
            };
        },
        _render_vouchers: function (vouchers_created) {
            let el_pos_receipt = $('.pos-receipt-container');
            let url_location = window.location.origin + '/report/barcode/EAN13/';
            for (let i = 0; i < vouchers_created.length; i++) {
                let voucher = vouchers_created[i];
                voucher['url_barcode'] = url_location + voucher['code'];
                el_pos_receipt.append(
                    qweb.render('VoucherCard', this._get_voucher_env(voucher))
                );
            }
        },
        format_currency: function (amount, precision) {
            let order_selected = this.get_order();
            if (order_selected && order_selected.currency) {
                let currency = (order_selected && order_selected.currency) ? order_selected.currency : {
                    symbol: '$',
                    position: 'after',
                    rounding: 0.01,
                    decimals: 2
                };
                amount = this.format_currency_no_symbol(amount, precision);
                if (currency.position === 'after') {
                    return amount + ' ' + (currency.symbol || '');
                } else {
                    return (currency.symbol || '') + ' ' + amount;
                }
            } else {
                return _super_PosModel.format_currency.call(this, amount, precision);
            }
        },
        _save_to_server: function (orders, options) {
            let self = this;
            this.partner_need_update_ids = [];
            this.wait_print_voucher = false;
            if (orders.length) {
                if (orders.length == 1 && orders[0] == undefined) {
                    return Promise.resolve([]);
                }
                for (let n = 0; n < orders.length; n++) {
                    if (!orders[n]['data']) {
                        continue
                    }
                    let order = orders[n]['data'];
                    if (order.partner_id) {
                        this.partner_need_update_ids.push(order.partner_id)
                    }
                    for (let i = 0; i < order.lines.length; i++) {
                        let line = order.lines[i][2];
                        if (line.voucher) {
                            this.wait_print_voucher = true;
                            break;
                        }
                    }
                }
            }
            return _super_PosModel._save_to_server.call(this, orders, options).then(function (backendOrderValue) {
                console.log('[_save_to_server] new orders: ' + _.pluck(backendOrderValue, 'id'))
                if (backendOrderValue.length == 1) {
                    if (backendOrderValue) {
                        let frontend_order = self.get_order();
                        for (let i = 0; i < backendOrderValue.length; i++) {
                            let backend_order = backendOrderValue[i];
                            if (frontend_order && frontend_order.ean13 == backend_order['ean13']) {
                                frontend_order['backendOrder'] = backend_order
                                frontend_order.invoice_ref = backend_order.invoice_ref;
                                frontend_order.picking_ref = backend_order.picking_ref;
                                if (backend_order.included_order_fields_extend) {
                                    frontend_order.order_fields_extend = backend_order.order_fields_extend;
                                }
                                if (backend_order.included_delivery_fields_extend) {
                                    frontend_order.delivery_fields_extend = backend_order.delivery_fields_extend;
                                }
                                if (backend_order.included_invoice_fields_extend) {
                                    frontend_order.invoice_fields_extend = backend_order.invoice_fields_extend;
                                }

                            }
                        }
                    }
                    if (self.partner_need_update_ids.length) {
                        for (let i = 0; i < self.partner_need_update_ids.length; i++) {
                            self.load_new_partners(self.partner_need_update_ids[i]);
                        }
                    }
                    if (self.wait_print_voucher) {
                        self.rpc.query({
                            model: 'pos.voucher',
                            method: 'get_vouchers_by_order_ids',
                            args: [[], _.pluck(backendOrderValue, 'id')]
                        }).then(function (vouchers_created) {
                            if (vouchers_created.length) {
                                self.wait_print_voucher = false;
                                self.vouchers_created = vouchers_created;
                                self._render_vouchers(self.vouchers_created);
                            }
                        })
                    }
                }
                self.partner_need_update_ids = [];
                return backendOrderValue
            });
        },
        push_single_order: function (order, opts) {
            let pushed = _super_PosModel.push_single_order.call(this, order, opts);
            if (!order) {
                return pushed;
            }
            let client = order && order.get_client();
            if (client) {
                for (let i = 0; i < order.paymentlines.models.length; i++) {
                    let line = order.paymentlines.models[i];
                    let amount = line.get_amount();
                    let pos_method_type = line.payment_method.pos_method_type;
                    if (pos_method_type == 'wallet') {
                        client.wallet = -amount;
                    }
                    if (pos_method_type == 'credit') {
                        client.balance -= line.get_amount();
                    }
                }
            }
            return pushed;
        },
        // push_and_invoice_order: function (order) {
        //     if (!this.config.receipt_manual_download_invoice) {
        //         return _super_PosModel.push_and_invoice_order.call(this, order);
        //     } else {
        //         return _super_PosModel.push_single_order.call(this, order);
        //     }
        // },
        get_balance: function (client) {
            let balance = round_pr(client.balance, this.currency.rounding);
            return (Math.round(balance * 100) / 100).toString()
        },
        get_wallet: function (client) {
            let wallet = round_pr(client.wallet, this.currency.rounding);
            return (Math.round(wallet * 100) / 100).toString()
        },
        add_return_order: function (order_return, lines) {
            let self = this;
            let order_return_id = order_return['id'];
            let order_selected_state = order_return['state'];
            let partner_id = order_return['partner_id'];
            let return_order_id = order_return['id'];
            let order = new models.Order({}, {pos: this});
            order['is_return'] = true;
            order['return_order_id'] = return_order_id;
            order['pos_reference'] = 'Return/' + order['name'];
            order['name'] = 'Return/' + order['name'];
            this.get('orders').add(order);
            if (partner_id && partner_id[0]) {
                let client = this.db.get_partner_by_id(partner_id[0]);
                if (client) {
                    order.set_client(client);
                } else {
                    order.set_to_invoice(false)
                }
            } else {
                order.set_to_invoice(false)
            }
            this.set('selectedOrder', order);
            for (let i = 0; i < lines.length; i++) {
                let line_return = lines[i];
                if (line_return['is_return']) {
                    this.db.remove_order(order.id);
                    order.destroy({'reason': 'abandon'});
                    return this.chrome.showPopup('ConfirmPopup', {
                        title: _t('Warning'),
                        body: _t('This order is order return before, it not possible return again')
                    })
                }
                let price = line_return['price_unit'];
                if (price < 0) {
                    price = -price;
                }
                let quantity = 0;
                let product = this.db.get_product_by_id(line_return.product_id[0]);
                if (!product) {
                    this.db.remove_order(order.id);
                    order.destroy({'reason': 'abandon'});
                    return this.chrome.showPopup('ConfirmPopup', {
                        title: _t('Warning'),
                        body: _t(line_return.product_id[0] + ' not available in POS, it not possible made return')
                    })
                }
                let line = new models.Orderline({}, {
                    pos: this,
                    order: order,
                    product: product,
                });
                order.orderlines.add(line);
                // todo: set lot back
                // let pack_operation_lots = this.pack_operation_lots_by_pos_order_line_id[line_return.id];
                // if (pack_operation_lots) {
                //     let multi_lot_ids = [];
                //     let lot_name_manual = null;
                //     for (let i = 0; i < pack_operation_lots.length; i++) {
                //         let pack_operation_lot = pack_operation_lots[i];
                //         if (pack_operation_lot.lot_id) {
                //             multi_lot_ids.push({
                //                 'id': pack_operation_lot.lot_id[0],
                //                 'quantity': pack_operation_lot.quantity
                //             })
                //         } else {
                //             lot_name_manual = pack_operation_lot.lot_name
                //         }
                //     }
                //     if (multi_lot_ids.length) { // todo: only for multi lot
                //         line.set_multi_lot(multi_lot_ids)
                //     }
                //     if (lot_name_manual) { // todo: only for one lot
                //         let pack_lot_lines = line.compute_lot_lines();
                //         for (let i = 0; i < pack_lot_lines.models.length; i++) {
                //             let pack_line = pack_lot_lines.models[i];
                //             pack_line.set_lot_name(lot_name_manual)
                //         }
                //         pack_lot_lines.remove_empty_model();
                //         pack_lot_lines.set_quantity_by_lot();
                //         line.order.save_to_db();
                //     }
                // }
                if (line_return['variant_ids']) {
                    line.set_variants(line_return['variant_ids'])
                }
                if (line_return['tag_ids']) {
                    line.set_tags(line_return['tag_ids'])
                }
                line['returned_order_line_id'] = line_return['id'];
                line['is_return'] = true;
                line.set_unit_price(price);
                line.price_manually_set = true;
                if (line_return.discount)
                    line.set_discount(line_return.discount);
                if (line_return.discount_reason)
                    line.discount_reason = line_return.discount_reason;
                if (line_return['new_quantity']) {
                    quantity = -line_return['new_quantity']
                } else {
                    quantity = -line_return['qty']
                }
                if (line_return.promotion) {
                    quantity = -quantity;
                }
                if (line_return.redeem_point) {
                    quantity = -quantity;
                    line.credit_point = line_return.redeem_point;
                }
                if (quantity > 0) {
                    quantity = -quantity;
                }
                line.set_quantity(quantity, 'keep price when return');
            }
            if (this.combo_picking_by_order_id) {
                let combo_picking_id = this.combo_picking_by_order_id[return_order_id];
                if (combo_picking_id) {
                    moves = this.stock_moves_by_picking_id[combo_picking_id];
                    for (let n = 0; n < moves.length; n++) {
                        let price = 0;
                        let move = moves[n];
                        let product = this.db.get_product_by_id(move.product_id[0]);
                        if (!product) {
                            this.pos.alert_message({
                                title: 'Warning',
                                body: 'Product ID ' + move.product_id[1] + ' have removed out of POS. Take care'
                            });
                            continue
                        }
                        if (move.product_uom_qty == 0) {
                            continue
                        }
                        let line = new models.Orderline({}, {
                            pos: this,
                            order: order,
                            product: product,
                        });
                        order.orderlines.add(line);
                        line['is_return'] = true;
                        line.set_unit_price(price);
                        line.price_manually_set = true;
                        line.set_quantity(-move.product_uom_qty, 'keep price when return');
                    }
                }
            }

            if (order_selected_state.is_paid_full == false) {
                return new Promise(function (resolve, reject) {
                    rpc.query({
                        model: 'account.bank.statement.line',
                        method: 'search_read',
                        domain: [['pos_statement_id', '=', order_return_id]],
                        fields: [],
                    }).then(function (statements) {
                        let last_paid = 0;
                        for (let i = 0; i < statements.length; i++) {
                            let statement = statements[i];
                            last_paid += statement['amount'];
                        }
                        last_paid = self.format_currency(last_paid);
                        self.alert_message({
                            'title': _t('Warning'),
                            'body': 'Selected Order need return is partial payment, and customer only paid: ' + last_paid + ' . Please return back money to customer correctly',
                        });
                        resolve()
                    }, function (error) {
                        reject()
                    })
                })
            } else {
                let payment_method = _.find(this.payment_methods, function (method) {
                    return method['journal'] && method['journal']['pos_method_type'] == 'default' && method['journal'].type == 'cash';
                });
                if (payment_method) {
                    order.add_paymentline(payment_method);
                    let amount_withtax = order.get_total_with_tax();
                    order.selected_paymentline.set_amount(amount_withtax);
                    order.trigger('change', order);
                    this.trigger('auto_update:paymentlines', this);
                }
            }
        },
        add_refill_order: function (order, lines) {
            let partner_id = order['partner_id'];
            let newOrder = new models.Order({}, {pos: this});
            this.get('orders').add(newOrder);
            if (partner_id && partner_id[0]) {
                let client = this.db.get_partner_by_id(partner_id[0]);
                if (client) {
                    newOrder.set_client(client);
                }
            }
            this.set('selectedOrder', newOrder);
            for (let i = 0; i < lines.length; i++) {
                let line_refill = lines[i];
                let price = line_refill['price_unit'];
                if (price < 0) {
                    price = -price;
                }
                let quantity = 0;
                let product = this.db.get_product_by_id(line_refill.product_id[0]);
                if (!product) {
                    console.error('Could not find product: ' + line_refill.product_id[0]);
                    continue
                }
                let line = new models.Orderline({}, {
                    pos: this,
                    order: newOrder,
                    product: product,
                });
                newOrder.orderlines.add(line);
                if (line_refill['variant_ids']) {
                    line.set_variants(line_refill['variant_ids'])
                }
                if (line_refill['tag_ids']) {
                    line.set_tags(line_refill['tag_ids'])
                }
                line.set_unit_price(price);
                line.price_manually_set = true;
                if (line_refill.discount)
                    line.set_discount(line_refill.discount);
                if (line_refill.discount_reason)
                    line.discount_reason = line_refill.discount_reason;
                if (line_refill['new_quantity']) {
                    quantity = line_refill['new_quantity']
                } else {
                    quantity = line_refill['qty']
                }
                line.set_quantity(quantity, 'keep price when return');
            }
        }
        ,
        lock_order: function () {
            $('.rightpane').addClass('oe_hidden');
            $('.timeline').addClass('oe_hidden');
            $('.find_customer').addClass('oe_hidden');
            $('.leftpane').css({'left': '0px'});
            $('.numpad').addClass('oe_hidden');
            $('.actionpad').addClass('oe_hidden');
            $('.deleteorder-button').addClass('oe_hidden');
        }
        ,
        unlock_order: function () {
            $('.rightpane').removeClass('oe_hidden');
            $('.timeline').removeClass('oe_hidden');
            $('.find_customer').removeClass('oe_hidden');
            $('.numpad').removeClass('oe_hidden');
            $('.actionpad').removeClass('oe_hidden');
            if (this.config.staff_level == 'manager') {
                $('.deleteorder-button').removeClass('oe_hidden');
            }
        },
        // set_synch: function (status, pending) {
        //     if (['connected', 'connecting', 'error', 'disconnected'].indexOf(status) === -1) {
        //         console.error(status, ' is not a known connection state.');
        //     }
        //     pending = pending || this.db.get_orders().length + this.db.get_ids_to_remove_from_server().length;
        //     pending = pending + ' [Orders Removed] '
        //     this.set('synch', {status, pending});
        // },

        load_server_data_by_model: function (model) {
            let self = this;
            let tmp = {};
            let fields = typeof model.fields === 'function' ? model.fields(self, tmp) : model.fields;
            let domain = typeof model.domain === 'function' ? model.domain(self, tmp) : model.domain;
            let context = typeof model.context === 'function' ? model.context(self, tmp) : model.context || {};
            let ids = typeof model.ids === 'function' ? model.ids(self, tmp) : model.ids;
            let order = typeof model.order === 'function' ? model.order(self, tmp) : model.order;
            const loaded = new Promise(function (resolve, reject) {
                let params = {
                    model: model.model,
                    context: _.extend(context, session.user_context || {}),
                };
                if (model.ids) {
                    params.method = 'read';
                    params.args = [ids, fields];
                } else {
                    params.method = 'search_read';
                    params.domain = domain;
                    params.fields = fields;
                    params.orderBy = order;
                }
                rpc.query(params, {
                    timeout: 30000,
                    shadow: true,
                }).then(function (result) {
                    try {    // catching exceptions in model.loaded(...)
                        Promise.resolve(model.loaded(self, result, tmp)).then(function () {
                            resolve()
                            posbus.trigger('reload-orders', {})
                        }, function (err) {
                            if (err.message && err.message.code == -32098) {
                                self.chrome.showPopup('ErrorPopup', {
                                    title: _t('Error'),
                                    body: _t('Your Odoo or Internet is Offline')
                                })
                            }
                            resolve(err)
                        });
                    } catch (err) {
                        if (err.message && err.message.code == -32098) {
                            self.chrome.showPopup('ErrorPopup', {
                                title: _t('Error'),
                                body: _t('Your Odoo or Internet is Offline')
                            })
                        }
                        resolve(err)
                    }
                }, function (err) {
                    if (err.message && err.message.code == -32098) {
                        self.chrome.showPopup('ErrorPopup', {
                            title: _t('Error'),
                            body: _t('Your Odoo or Internet is Offline')
                        })
                    }
                    resolve(err)
                });
            });
            return loaded;
        }
    });
//
// //TODO: validate click change minus
// let _super_NumpadState = models.NumpadState.prototype;
// models.NumpadState = models.NumpadState.extend({
//     switchSign: function () {
//         self.posmodel.switchSign = this;
//         if (self.posmodel.config.validate_change_minus) {
//             return self.posmodel.gui.show_popup('ask_password', {
//                 title: 'Pos pass pin ?',
//                 body: 'Please use pos security pin for unlock',
//                 confirm: function (value) {
//                     let pin;
//                     if (self.posmodel.config.manager_validate) {
//                         let user_validate = self.posmodel.user_by_id[this.pos.config.manager_user_id[0]];
//                         pin = user_validate['pos_security_pin']
//                     } else {
//                         pin = self.posmodel.user.pos_security_pin
//                     }
//                     if (value != pin) {
//                         return self.posmodel.gui.show_popup('dialog', {
//                             title: 'Wrong',
//                             body: 'Pos security pin not correct'
//                         })
//                     } else {
//                         return _super_NumpadState.switchSign.apply(this.pos.switchSign, arguments);
//                     }
//                 }
//             });
//         } else {
//             return _super_NumpadState.switchSign.apply(this, arguments);
//         }
//     }
// });

// TODO: PROBLEM IS ( if we have 100k, 500k or few millions products record ) and when change pricelist, take a lot times render qweb
// TODO SOLUTION: we force method get_price of product recordset to posmodel, see to method get_price of LoadModel.js
    models.Product = models.Product.extend({
        /*
            We not use exports.Product because if you have 1 ~ 10 millions data products
            Original function odoo will crashed browse memory
         */
        covertCurrency(pricelist, price) {
            let baseCurrency = this.pos.currency_by_id[this.pos.config.currency_id[0]];
            if (pricelist.currency_id && baseCurrency && baseCurrency.id != pricelist.currency_id[0]) {
                let currencySelected = this.pos.currency_by_id[pricelist.currency_id[0]];
                if (currencySelected && currencySelected['converted_currency'] != 0) {
                    price = (currencySelected['converted_currency'] * price);
                }
            }
            return price

        },
        get_price: function (pricelist, quantity, uom_id) {
            let self = this;
            if (!quantity) {
                quantity = 1
            }
            if (!this.base_price) {
                this.base_price = this.lst_price;
            }
            if (!pricelist) {
                return self['lst_price'];
            }
            if (pricelist['items'] == undefined) {
                return self['lst_price'];
            }
            let date = moment().startOf('day');
            let category_ids = [];
            let category = self.categ;
            while (category) {
                category_ids.push(category.id);
                category = category.parent;
            }
            let pos_category_ids = []
            let pos_category = self.pos_category;
            while (pos_category) {
                pos_category_ids.push(pos_category.id);
                pos_category = pos_category.parent;
            }
            let pricelist_items = [];
            for (let i = 0; i < pricelist.items.length; i++) {
                let item = pricelist.items[i];
                let theSameUnit = !item.uom_id || (!uom_id && self.uom_id && item.uom_id && item.uom_id[0] == self.uom_id[0]) || (uom_id != undefined)
                if ((!item.product_tmpl_id || item.product_tmpl_id[0] === self.product_tmpl_id) &&
                    (!item.product_id || item.product_id[0] === self.id) &&
                    (!item.categ_id || _.contains(category_ids, item.categ_id[0])) &&
                    (!item.pos_category_id || _.contains(pos_category_ids, item.pos_category_id[0])) &&
                    (!item.date_start || moment(item.date_start).isSameOrBefore(date)) &&
                    (theSameUnit) &&
                    (!item.date_end || moment(item.date_end).isSameOrAfter(date))) {
                    if (!uom_id) {
                        pricelist_items.push(item)
                    } else {
                        // TODO: if have parameter uom_id, we get only one pricelist item have set uom ID the same with param and break
                        if (item.product_id && item.product_id[0] == self.id && item.uom_id && item.uom_id[0] == uom_id) {
                            pricelist_items = [item]
                            break;
                        }
                    }

                }
            }
            let price = self['lst_price'];
            _.find(pricelist_items, function (rule) {
                if (rule.min_quantity && quantity < rule.min_quantity) {
                    return false;
                }
                if (rule.base === 'pricelist') {
                    price = self.get_price(rule.base_pricelist, quantity, uom_id);
                } else if (rule.base === 'standard_price') {
                    price = self.standard_price;
                }
                if (rule.compute_price === 'fixed') {
                    price = rule.fixed_price;
                    return true;
                } else if (rule.compute_price === 'percentage') {
                    price = price - (price * (rule.percent_price / 100));
                    return true;
                } else {
                    let price_limit = price;
                    price = price - (price * (rule.price_discount / 100));
                    if (rule.price_round) {
                        price = round_pr(price, rule.price_round);
                    }
                    if (rule.price_surcharge) {
                        price += rule.price_surcharge;
                    }
                    if (rule.price_min_margin) {
                        price = Math.max(price, price_limit + rule.price_min_margin);
                    }
                    if (rule.price_max_margin) {
                        price = Math.min(price, price_limit + rule.price_max_margin);
                    }
                    return true;
                }
                return false;
            });
            price = this.covertCurrency(pricelist, price);
            if ((price - this.base_price) != 0) {
                this.difference_price = true
            }
            return price;
        }
        ,
        /*
            This function return product amount with default tax set on product > sale > taxes
         */
        get_price_with_tax: function (pricelist) {
            let self = this;
            let price;
            if (pricelist) {
                price = this.get_price(pricelist, 1);
            } else {
                price = self['lst_price'];
            }
            let taxes_id = self['taxes_id'];
            if (!taxes_id) {
                return price;
            }
            let tax_amount = 0;
            let base_amount = price;
            if (taxes_id.length > 0) {
                for (let index_number in taxes_id) {
                    let tax = self.pos.taxes_by_id[taxes_id[index_number]];
                    if ((tax && tax.price_include) || !tax) {
                        continue;
                    } else {
                        if (tax.amount_type === 'fixed') {
                            let sign_base_amount = base_amount >= 0 ? 1 : -1;
                            tax_amount += Math.abs(tax.amount) * sign_base_amount;
                        }
                        if ((tax.amount_type === 'percent' && !tax.price_include) || (tax.amount_type === 'division' && tax.price_include)) {
                            tax_amount += base_amount * tax.amount / 100;
                        }
                        if (tax.amount_type === 'percent' && tax.price_include) {
                            tax_amount += base_amount - (base_amount / (1 + tax.amount / 100));
                        }
                        if (tax.amount_type === 'division' && !tax.price_include) {
                            tax_amount += base_amount / (1 - tax.amount / 100) - base_amount;
                        }
                    }
                }
            }
            if (tax_amount) {
                return price + tax_amount
            } else {
                return price
            }
        },
    });
    let _super_Paymentline = models.Paymentline.prototype;
    models.Paymentline = models.Paymentline.extend({
        init_from_JSON: function (json) {
            let res = _super_Paymentline.init_from_JSON.apply(this, arguments);
            if (json.ref) {
                this.ref = json.ref
            }
            if (json.cheque_owner) {
                this.cheque_owner = json.cheque_owner
            }
            if (json.cheque_bank_id) {
                this.cheque_bank_id = json.cheque_bank_id
            }
            if (json.cheque_bank_account) {
                this.cheque_bank_account = json.cheque_bank_account
            }
            if (json.cheque_check_number) {
                this.cheque_check_number = json.cheque_check_number
            }
            if (json.cheque_card_name) {
                this.cheque_card_name = json.cheque_card_name
            }
            if (json.cheque_card_number) {
                this.cheque_card_number = json.cheque_card_number
            }
            if (json.cheque_card_type) {
                this.cheque_card_type = json.cheque_card_type
            }
            if (json.add_partial_amount_before) {
                this.add_partial_amount_before = json.add_partial_amount_before
            }
            if (json.voucher_id) {
                this.voucher_id = json.voucher_id
            }
            if (json.voucher_code) {
                this.voucher_code = json.voucher_code
            }
            return res
        },
        export_as_JSON: function () {
            let json = _super_Paymentline.export_as_JSON.apply(this, arguments);
            if (this.ref) {
                json['ref'] = this.ref;
            }
            if (this.cheque_owner) {
                json['cheque_owner'] = this.cheque_owner;
            }
            if (this.cheque_bank_id) {
                json['cheque_bank_id'] = this.cheque_bank_id;
            }
            if (this.cheque_bank_account) {
                json['cheque_bank_account'] = this.cheque_bank_account;
            }
            if (this.cheque_check_number) {
                json['cheque_check_number'] = this.cheque_check_number;
            }
            if (this.cheque_card_name) {
                json['cheque_card_name'] = this.cheque_card_name;
            }
            if (this.cheque_card_number) {
                json['cheque_card_number'] = this.cheque_card_number;
            }
            if (this.cheque_card_type) {
                json['cheque_card_type'] = this.cheque_card_type;
            }
            if (this.voucher_id) {
                json['voucher_id'] = this.voucher_id;
            }
            if (this.voucher_code) {
                json['voucher_code'] = this.voucher_code;
            }
            if (this.add_partial_amount_before) {
                json['add_partial_amount_before'] = this.add_partial_amount_before;
            }
            return json
        },
        export_for_printing: function () {
            let datas = _super_Paymentline.export_for_printing.apply(this, arguments);
            if (this.ref) {
                datas['ref'] = this.ref
            }
            if (this.cheque_check_number) {
                datas['cheque_check_number'] = this.cheque_check_number
            }
            if (this.cheque_card_name) {
                datas['cheque_card_name'] = this.cheque_card_name
            }
            if (this.cheque_card_number) {
                datas['cheque_card_number'] = this.cheque_card_number
            }
            if (this.cheque_card_type) {
                datas['cheque_card_type'] = this.cheque_card_type
            }
            if (this.voucher_id) {
                datas['voucher_id'] = this.voucher_id
            }
            if (this.voucher_code) {
                datas['voucher_code'] = this.voucher_code
            }
            if (this.add_partial_amount_before) {
                datas['add_partial_amount_before'] = this.add_partial_amount_before
            }
            return datas
        },
        set_reference: function (ref) {
            this.ref = ref;
            this.trigger('change', this)
        },
        set_amount: function (value) {
            if (this.add_partial_amount_before) {
                return this.pos.chrome.showPopup('ErrorPopup', {
                    title: _t('Warning'),
                    body: this.ref + _t(' . Not allow edit amount of this payment line. If you wanted edit, please remove this Line')
                })
            }
            _super_Paymentline.set_amount.apply(this, arguments);
            this.pos.trigger('update:customer-facing-screen');

        },
    });
})
;
