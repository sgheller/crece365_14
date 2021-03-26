odoo.define('pos_retail.SaleOrderDetail', function (require) {
    'use strict';

    const {getDataURLFromFile} = require('web.utils');
    const PosComponent = require('point_of_sale.PosComponent');
    const Registries = require('point_of_sale.Registries');
    const {useListener} = require('web.custom_hooks');
    const models = require('point_of_sale.models');
    const core = require('web.core');
    const qweb = core.qweb;
    const {posbus} = require('point_of_sale.utils');

    class SaleOrderDetail extends PosComponent {
        constructor() {
            super(...arguments);
            useListener('actionPrint', () => this.actionPrint());
            useListener('actionConfirmSale', () => this.actionConfirmSale());
            useListener('actionDone', () => this.actionDone());
            useListener('covertToPosOrder', () => this.covertToPosOrder());
        }

        async covertToPosOrder() {
            if (this.props.order.state == 'booked' && this.props.order.pos_order_id) {
                let {confirmed, payload: result} = await this.showPopup('ConfirmPopup', {
                    title: this.env._t('Alert !!!'),
                    body: this.env._t('This Order has coverted to POS Order') + this.props.order.pos_order_id[1] + this.env._t(', are you sure do it again ?'),
                })
                if (!confirmed) {
                    return
                }
            }
            if (this.props.order.reserve_table_id && (!this.env.pos.tables_by_id || !this.env.pos.tables_by_id[this.props.order.reserve_table_id[0]])) {
                return this.showPopup('ErrorPopup', {
                    title: this.env._t('Error'),
                    body: this.env._t('Order Reserved for table: ') + this.props.order.reserve_table_id[1] + this.env._t(' .But your POS have not this Taable, it not possible for customer can CheckIn')
                })
            }
            if (this.props.order.reserve_table_id) {
                let orders = this.env.pos.get('orders').models;
                let orderOfTable = orders.find(o => o.table && o.table['id'] == this.props.order.reserve_table_id[0])
                if (orderOfTable) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.props.order.reserve_table_id[1] + this.env._t(' have another Order on it. Please finish or remove it the first.')
                    })
                }
            }
            const last_covert_order = this.env.pos.get('orders').models.find(o => o.booking_id == this.props.order.id)
            if (last_covert_order) {
                return this.env.pos.set('selectedOrder', last_covert_order);
            }
            var lines = this.env.pos.db.lines_sale_by_id[this.props.order['id']];
            if (!lines) {
                return this.showPopup('ErrorPopup', {
                    title: this.env._t('Warning'),
                    body: this.env._t('Order Lines is blank')
                })
            }
            var order = new models.Order({}, {pos: this.env.pos, temporary: false});
            if (this.props.order.reserve_table_id[0]) {
                let table = this.env.pos.tables_by_id[this.props.order.reserve_table_id[0]]
                let floor = this.env.pos.floors_by_id[table.floor_id[0]];
                if (table && floor) {
                    order.table = table;
                    order.table_id = table.id;
                    order.floor = floor;
                    order.floor_id = floor.id;
                }
            }
            order['name'] = this.props.order['name'];
            order['delivery_address'] = this.props.order['delivery_address'];
            order['delivery_date'] = this.props.order['delivery_date'];
            order['delivery_phone'] = this.props.order['delivery_phone'];
            order['booking_id'] = this.props.order['id'];
            var partner_id = this.props.order['partner_id'];
            var partner = this.env.pos.db.get_partner_by_id(partner_id[0]);
            if (partner) {
                order.set_client(partner);
            } else {
                order.temporary = true;
                order.destroy({'reason': 'abandon'});
                return this.showPopup('ErrorPopup', {
                    title: this.env._t('Error'),
                    body: this.env._t('Customer: ') + partner_id[1] + this.env._t(' not available on pos, please update this partner active on POS'),
                })
            }
            if (this.props.order.pricelist_id) {
                var pricelist = this.env.pos.pricelist_by_id[this.props.order.pricelist_id[0]]
                if (pricelist) {
                    order.set_pricelist(pricelist)
                }
            }
            var added_line = false;
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                var product = this.env.pos.db.get_product_by_id(line.product_id[0]);
                if (!product) {
                    continue
                } else {
                    added_line = true;
                    var new_line = new models.Orderline({}, {pos: this.env.pos, order: order, product: product});
                    new_line.set_quantity(line.product_uom_qty, 'keep price');
                    order.orderlines.add(new_line);
                    new_line.set_discount(line.discount || 0);
                    if (line.variant_ids) {
                        var variants = _.map(line.variant_ids, function (variant_id) {
                            if (this.env.pos.variant_by_id[variant_id]) {
                                return this.env.pos.variant_by_id[variant_id]
                            }
                        });
                        new_line.set_variants(variants);
                    }
                    if (line.pos_note) {
                        new_line.set_line_note(line.pos_note);
                    }
                    if (line.product_uom) {
                        var uom_id = line.product_uom[0];
                        var uom = this.env.pos.uom_by_id[uom_id];
                        if (uom) {
                            new_line.set_unit(line.product_uom[0]);
                        } else {
                            this.env.pos.alert_message({
                                title: this.env._t('Alert'),
                                body: this.env._t('Your pos have not unit ') + line.product_uom[1]
                            })
                        }
                    }
                    new_line.set_unit_price(line.price_unit);
                }
            }
            var orders = this.env.pos.get('orders');
            orders.add(order);
            this.env.pos.set('selectedOrder', order);
            if (!added_line) {
                order.temporary = true;
                order.destroy({'reason': 'abandon'});
                return this.showPopup('ErrorPopup', {
                    title: this.env._t('Error'),
                    body: this.env._t('Lines of Booked Order have not any products available in pos, made sure all products of Booked Order have check to checkbox [Available in pos]')
                })
            }
            if (this.props.order['payment_partial_amount']) {
                var ref = this.env._t('This order have paid before: ') + this.env.pos.format_currency(this.props.order['payment_partial_amount']);
                ref += this.env._t(' Sale Order name: ') + this.props.order.name;
                var payment_partial_method_id = this.props.order['payment_partial_method_id'][0];
                var payment_method = _.find(this.env.pos.payment_methods, function (method) {
                    return method.id == payment_partial_method_id;
                });
                if (payment_method) {
                    order.add_paymentline(payment_method);
                    var paymentline = order.selected_paymentline;
                    paymentline.set_amount(this.props.order['payment_partial_amount']);
                    paymentline.add_partial_amount_before = true;
                    paymentline.set_reference(ref);
                }
                this.showPopup('ConfirmPopup', {
                    title: this.env._t('Alert, Order have paid one part before !!!'),
                    body: ref,
                    disableCancelButton: true,
                })
            }
            this.trigger('close-temp-screen');
        }

        async actionDone() {
            await this.rpc({
                model: 'sale.order',
                method: 'action_done',
                args:
                    [[this.props.order.id]],
                context: {
                    pos: true
                }
            })
            await this.env.pos.sync_products_partners();
        }

        async actionConfirmSale() {
            await this.rpc({
                model: 'sale.order',
                method: 'action_confirm',
                args:
                    [[this.props.order.id]],
                context: {
                    pos: true
                }
            })
            await this.env.pos.reloadSaleOrder()
            var new_order = this.env.pos.db.sale_order_by_id[this.props.order.id];
            this.props.order = new_order;
            this.render()
        }

        async actionPrint() {
            await this.env.pos.do_action('sale.action_report_saleorder', {
                additional_context: {
                    active_ids: [this.props.order.id]
                }
            })
        }

        async downloadOrderReport() {
            this.env.pos.do_action('pos_retail.report_pos_order', {
                additional_context: {
                    active_ids: [this.props.order.id],
                }
            });
        }

        async downloadDeliveryReport() {
            let picking_ids = await this.rpc({
                model: 'stock.picking',
                method: 'search_read',
                domain: [['pos_order_id', '=', this.props.order.id]],
                fields: ['id'],
                context: {
                    limit: 1
                }
            })
            if (picking_ids.length > 0) {
                this.env.pos.do_action('stock.action_report_picking', {
                    additional_context: {
                        active_ids: [picking_ids[0]['id']],
                    }
                });
            }
        }

        async covertToCredit() {
        }

        async covertToVoucher() {
            let number = await this.env.pos._get_voucher_number()
            const {confirmed, payload} = await this.showPopup('PopUpPrintVoucher', {
                title: this.env._t('Covert Return Order to Voucher'),
                number: number,
                value: this.props.order.amount_total,
                period_days: this.env.pos.config.expired_days_voucher,
            });
            if (confirmed) {
                let values = payload.values;
                let error = payload.error;
                if (!error) {
                    let voucher = await this.rpc({
                        model: 'pos.voucher',
                        method: 'create_from_ui',
                        args: [[], values],
                        context: {}
                    })
                    let url_location = window.location.origin + '/report/barcode/EAN13/';
                    voucher['url_barcode'] = url_location + voucher['code'];
                    let report_html = qweb.render('VoucherCard', this.env.pos._get_voucher_env(voucher));
                    let updateOrder = await this.rpc({
                        model: 'pos.order',
                        method: 'write',
                        args: [[this.props.order.id], {
                            'is_returned': true
                        }],
                        context: {}
                    })
                    await this.env.pos.sync_products_partners();
                    var new_order = this.env.pos.db.order_by_id[this.props.order.id];
                    this.props.order = new_order;
                    this.trigger('close-temp-screen');
                    this.showScreen('ReportScreen', {
                        report_html: report_html
                    });
                } else {
                    this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: error,
                    })
                }
            }
        }

        async refillOrder() {
            let order = this.props.order;
            let lines = this.env.pos.db.lines_by_order_id[order['id']];
            if (!lines || lines.length == 0) {
                return this.showPopup('ErrorPopup', {
                    title: this.env._t('Error'),
                    body: this.env._t('Order Lines not found')
                })
            }
            this.env.pos.add_refill_order(order, lines);
            this.trigger('close-temp-screen');
        }

        async returnOrder() {
            let order = this.props.order;
            let lines = this.env.pos.db.lines_by_order_id[order['id']];
            if (!lines || lines.length == 0) {
                return this.showPopup('ErrorPopup', {
                    title: this.env._t('Error'),
                    body: this.env._t('Order Lines not found')
                })
            }
            this.env.pos.add_return_order(order, lines);
            this.trigger('close-temp-screen');
            if (this.env.pos.config.required_reason_return) {
                let {confirmed, payload: note} = await this.showPopup('TextAreaPopup', {
                    title: this.env._t('Add some notes why customer return products ?'),
                })
                if (confirmed) {
                    var selectedOrder = this.env.pos.get_order();
                    selectedOrder.set_note(note)
                    selectedOrder.submitOrderToBackEnd()
                } else {
                    this.showPopup('ErrorPopup', {
                        title: this.env._t('Warning'),
                        body: this.env._t('You missed input Reason return Order')
                    })
                }
            }

        }

        async downloadInvoice() {
            let order = this.props.order;
            let download_invoice = await this.env.pos.do_action('account.account_invoices', {
                additional_context: {
                    active_ids: [order.account_move[0]]
                }
            })
            return download_invoice
        }

        async orderToInvoice() {
            var self = this;
            let order = this.props.order;
            await this.rpc({
                model: 'pos.order',
                method: 'action_pos_order_invoice',
                args: [[order.id]],
            }).then(function (result) {
                return result
            }, function (err) {
                return self.env.pos.query_backend_fail(err);
            })
            await this.env.pos.sync_products_partners();
            var new_order = this.env.pos.db.order_by_id[this.props.order.id];
            this.props.order = new_order;
            this.render()
            this.downloadInvoice()
        }

        async actionInvoice() {
            var self = this;
            let order = this.props.order;
            if (order.account_move) {
                return this.downloadInvoice()
            } else {
                if (!order.partner_id) {
                    this.showPopup('ConfirmPopup', {
                        title: this.env._t('Alert'),
                        body: this.env._t('Please set customer to Order before do action invoice'),
                        disableCancelButton: true,
                    })
                    let {confirmed, payload: newClient} = await this.showTempScreen(
                        'ClientListScreen',
                        {client: null}
                    );
                    if (newClient) {
                        await this.rpc({
                            model: 'pos.order',
                            method: 'write',
                            args: [[order.id], {'partner_id': newClient.id}],
                        }).then(function (result) {
                            return result
                        }, function (err) {
                            self.env.pos.query_backend_fail(err);
                            return false;
                        })
                        return this.orderToInvoice()
                    } else {
                        this.showPopup('ErrorPopup', {
                            title: this.env._t('Warning'),
                            body: this.env._t('Order missed Partner, please set Partner for this Order first')
                        })
                    }
                } else {
                    return this.orderToInvoice()
                }
            }
        }

        async cancelOrder() {
            var self = this;
            let order = this.props.order
            let {confirmed, payload: result} = await this.showPopup('ConfirmPopup', {
                title: this.env._t('Warning'),
                body: this.env._t('Are you want cancel this Order')
            })
            if (confirmed) {
                await this.rpc({
                    model: 'pos.order',
                    method: 'action_pos_order_cancel',
                    args: [[order.id]],
                }).then(function (result) {
                    return result
                }, function (err) {
                    self.env.pos.query_backend_fail(err);
                    return false;
                })
                await this.env.pos.sync_products_partners();
                var new_order = this.env.pos.db.order_by_id[this.props.order.id];
                this.props.order = new_order;
                this.render()
            }
        }

        async registerAmount() {
            var self = this;
            let debit_amount = await this.rpc({ // todo: template rpc
                model: 'pos.order',
                method: 'get_debit',
                args: [[], this.props.order.id],
            }).then(function (debit_amount) {
                return debit_amount
            }, function (err) {
                return self.env.pos.query_backend_fail(err);
            })
            if (debit_amount != 0) {
                const {confirmed, payload: values} = await this.showPopup('PopUpRegisterPayment', {
                    order: this.props.order,
                    id: this.props.order.id,
                    title: this.env._t('Do Register Payment:' + this.props.order.pos_reference),
                    amount: debit_amount,
                    payment_reference: this.props.order.pos_reference,
                    payment_methods: this.env.pos.payment_methods.filter((p) => (p.journal && p.pos_method_type && p.pos_method_type == 'default') || (!p.journal && !p.pos_method_type)),
                    payment_date: new Date().toISOString().split('T')[0],
                })
                if (confirmed) {
                    let payment_val = values.values
                    let payment = {
                        pos_order_id: this.props.order.id,
                        payment_method_id: payment_val.payment_method_id,
                        amount: payment_val['amount'],
                        name: payment_val['payment_reference'],
                        payment_date: payment_val['payment_date']
                    };
                    if (!payment.payment_method_id) {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: this.env._t('Payment Mode is required`')
                        })
                    }
                    if (payment_val['amount'] > debit_amount) {
                        payment_val['amount'] = debit_amount
                    }
                    if (!payment.payment_date) {
                        payment.payment_date = moment().format('YYYY-MM-DD');
                    }
                    await this.rpc({
                        model: 'pos.make.payment',
                        method: 'add_payment',
                        args: [[], payment],
                    }).then(function (payment_id) {
                        return payment_id
                    }, function (err) {
                        return self.env.pos.query_backend_fail(err);
                    })
                    await this.env.pos.sync_products_partners();
                    let new_order = this.env.pos.db.order_by_id[self.props.order.id];
                    this.props.order = new_order;
                    this.render()
                }
            } else {
                return this.showPopup('ErrorPopup', {
                    title: this.env._t('Warning'),
                    body: this.env._t('Order is Paid full or Your Odoo offline, could not check Amount Debit of Order')
                })
            }


        }

        async RePrintOrder() {
            await this.addBackOrder();
            this.env.pos.reportXML = qweb.render('XmlReceipt', this.env.pos.getReceiptEnv());
            this.showTempScreen('ReprintReceiptScreen', {order: this.env.pos.get_order()});

        }

        async editOrder() {
            await this.addBackOrder(true);
            this.trigger('close-temp-screen');
        }

        async addBackOrder(draft) {
            var self = this;
            var order = this.props.order;
            var lines = this.env.pos.db.lines_by_order_id[order['id']];
            if (!lines || !lines.length) {
                return this.showPopup('ErrorPopup', {
                    title: this.env._t('Error'),
                    body: this.env._t('Your order is blank cart'),
                });
            }
            if (draft) {
                let setToDraft = await this.rpc({ // todo: template rpc
                    model: 'pos.order',
                    method: 'write',
                    args: [[order.id], {'state': 'draft'}],
                })
                if (!setToDraft) {
                    return;
                }
            }
            var new_order = new models.Order({}, {pos: this.env.pos, temporary: true});
            var partner = order['partner_id'];
            if (partner) {
                var partner_id = partner[0];
                var partner = this.env.pos.db.get_partner_by_id(partner_id);
                new_order.set_client(partner);
            }
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                var product = this.env.pos.db.get_product_by_id(line.product_id[0]);
                if (!product) {
                    continue
                } else {
                    var new_line = new models.Orderline({}, {
                        pos: this.env.pos,
                        order: new_order,
                        product: product
                    });
                    new_line.set_quantity(line.qty, 'keep price, for re-print receipt');
                    new_order.orderlines.add(new_line);
                    if (line.discount) {
                        new_line.set_discount(line.discount);
                    }
                    if (line.discount_reason) {
                        new_line.discount_reason = line.discount_reason;
                    }
                    if (line.promotion) {
                        new_line.promotion = line.promotion;
                    }
                    if (line.promotion_reason) {
                        new_line.promotion_reason = line.promotion_reason;
                    }
                    if (line.note) {
                        new_line.set_line_note(line.note);
                    }
                    if (line.plus_point) {
                        new_line.plus_point = line.plus_point;
                    }
                    if (line.redeem_point) {
                        new_line.redeem_point = line.redeem_point;
                    }
                    if (line.uom_id) {
                        var uom_id = line.uom_id[0];
                        var uom = this.env.pos.uom_by_id[uom_id];
                        if (uom) {
                            new_line.set_unit(uom_id);
                        }
                    }
                    if (line.notice) {
                        new_line.notice = line.notice;
                    }
                    new_line.set_unit_price(line.price_unit);
                }
            }
            var orders = this.env.pos.get('orders');
            orders.add(new_order);
            this.env.pos.set('selectedOrder', new_order);
            new_order['uid'] = order['pos_reference'].split(' ')[1];
            new_order['pos_reference'] = order['pos_reference'];
            new_order['create_date'] = order['create_date'];
            new_order['ean13'] = order['ean13'];
            new_order['name'] = order['pos_reference'];
            new_order['date_order'] = order['date_order'];
            new_order['temporary'] = true;
            return new_order;
        }

        get partnerImageUrl() {
            const order = this.props.order;
            const partner = order.partner_id
            if (partner) {
                return `/web/image?model=res.partner&id=${partner[0]}&field=image_128&unique=1`;
            } else {
                return false;
            }
        }

        get OrderUrl() {
            const order = this.props.order;
            return window.location.origin + "/web#id=" + order.id + "&view_type=form&model=sale.order";
        }
    }

    SaleOrderDetail.template = 'SaleOrderDetail';

    Registries.Component.add(SaleOrderDetail);

    return SaleOrderDetail;
});
