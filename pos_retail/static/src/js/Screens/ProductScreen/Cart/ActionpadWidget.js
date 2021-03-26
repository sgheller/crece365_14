odoo.define('pos_retail.RetailActionpadWidget', function (require) {
    'use strict';

    const ActionpadWidget = require('point_of_sale.ActionpadWidget');
    const {useState} = owl.hooks;
    const Registries = require('point_of_sale.Registries');
    ActionpadWidget.template = 'RetailActionpadWidget';
    Registries.Component.add(ActionpadWidget);
    const core = require('web.core');
    const qweb = core.qweb;
    const {posbus} = require('point_of_sale.utils');
    const {Printer} = require('point_of_sale.Printer');
    const OrderReceipt = require('point_of_sale.OrderReceipt');
    const field_utils = require('web.field_utils');

    const RetailActionpadWidget = (ActionpadWidget) =>
        class extends ActionpadWidget {
            constructor() {
                super(...arguments);
                this._currentOrder = this.env.pos.get_order();
                this._currentOrder.orderlines.on('change', this._totalWillPaid, this);
                this._currentOrder.orderlines.on('remove', this._totalWillPaid, this);
                this._currentOrder.paymentlines.on('change', this._totalWillPaid, this);
                this._currentOrder.paymentlines.on('remove', this._totalWillPaid, this);
                this.env.pos.on('change:selectedOrder', this._updateCurrentOrder, this);
                this.state = useState({total: 0, tax: 0});
                this._totalWillPaid()
            }

            willUnmount() {
                this._currentOrder.orderlines.off('change', null, this);
                this.env.pos.off('change:selectedOrder', null, this);
            }

            _updateCurrentOrder(pos, newSelectedOrder) {
                this._currentOrder.orderlines.off('change', null, this);
                if (newSelectedOrder) {
                    this._currentOrder = newSelectedOrder;
                    this._currentOrder.orderlines.on('change', this._totalWillPaid, this);
                }
            }

            _totalWillPaid() {
                const total = this._currentOrder ? this._currentOrder.get_total_with_tax() : 0;
                const due = this._currentOrder ? this._currentOrder.get_due() : 0;
                const tax = this._currentOrder ? total - this._currentOrder.get_total_without_tax() : 0;
                this.state.total = this.env.pos.format_currency(due);
                this.state.tax = this.env.pos.format_currency(tax);
                this.render();
            }

            get allowDisplay() {
                let selectedOrder = this._currentOrder;
                if (!selectedOrder || !this.env.pos.config.allow_payment || (selectedOrder && selectedOrder.get_orderlines().length == 0)) {
                    return false
                } else {
                    return true
                }
            }

            async printReceipt() {
                const order = this.env.pos.get_order();
                if (!order) return;
                if (order.orderlines.length == 0) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Your order cart is blank')
                    })
                }
                if (this.env.pos.proxy.printer) {
                    if (this.env.pos.epson_printer_default || (this.env.pos.config.proxy_ip && this.env.pos.config.iface_print_via_proxy)) {
                        const printResult = await this.env.pos.proxy.printer.print_receipt(qweb.render('XmlReceipt', this.env.pos.getReceiptEnv()));
                        if (printResult.successful) {
                            return true;
                        } else {
                            this.showPopup('ErrorPopup', {
                                title: this.env._t('Error'),
                                body: this.env._t('Have something wrong about connection to IOTBox and printer')
                            })
                            return false;
                        }
                    } else {
                        const fixture = document.createElement('div');
                        const orderReceipt = new (Registries.Component.get(OrderReceipt))(this, {order});
                        await orderReceipt.mount(fixture);
                        const receiptHtml = orderReceipt.el.outerHTML;
                        const printResult = await this.env.pos.proxy.printer.print_receipt(receiptHtml);
                        if (!printResult.successful) {
                            this.showTempScreen('ReprintReceiptScreen', {order: order});
                        }
                    }
                } else {
                    posbus.trigger('set-screen', 'Receipt')
                    // this.showTempScreen('ReprintReceiptScreen', {order: order});
                }
            }

            async quicklyPaidOrder() {
                const self = this;
                const selectedOrder = this.env.pos.get_order();
                if (selectedOrder.orderlines.length == 0) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Your order cart is blank')
                    })
                }
                if (selectedOrder.is_to_invoice() && !selectedOrder.get_client()) {
                    this.showPopup('ConfirmPopup', {
                        title: this.env._t('Warning'),
                        body: this.env._t('Order will process to Invoice, please select one Customer for set to current Order'),
                        disableCancelButton: true,
                    })
                    const {confirmed, payload: newClient} = await this.showTempScreen(
                        'ClientListScreen',
                        {client: null}
                    );
                    if (confirmed) {
                        selectedOrder.set_client(newClient);
                    } else {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: this.env._t('Order will processing to Invoice, required set a Customer')
                        })
                    }
                }
                const linePriceSmallerThanZero = selectedOrder.orderlines.models.find(l => l.get_price_with_tax() <= 0 && !l.coupon_program_id && !l.promotion)
                if (this.env.pos.config.validate_return && linePriceSmallerThanZero) {
                    let validate = await this.env.pos._validate_action(this.env._t('Have one Line has Price smaller than or equal 0. Need Manager Approve'));
                    if (!validate) {
                        return false;
                    }
                }
                const lineIsCoupon = selectedOrder.orderlines.models.find(l => l.coupon_id || l.coupon_program_id);
                if (lineIsCoupon && this.env.pos.config.validate_coupon) {
                    let validate = await this.env.pos._validate_action(this.env._t('Order add coupon, required need Manager Approve'));
                    if (!validate) {
                        return false;
                    }
                }
                if (this.env.pos.config.validate_payment) {
                    let validate = await this.env.pos._validate_action(this.env._t('Need approve Payment'));
                    if (!validate) {
                        return false;
                    }
                }
                if (selectedOrder.get_total_with_tax() <= 0 || selectedOrder.orderlines.length == 0) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Your Order is Empty or Total Amount smaller or equal 0')
                    })
                }
                if (!this.env.pos.config.quickly_payment_method_id) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Your POS Config not set Quickly Payment Method, please go to Tab [Payment Screen] of POS Config and full fill to [Quickly Payment with Method]')
                    })
                }
                let quickly_payment_method = this.env.pos.payment_methods.find(m => m.id == this.env.pos.config.quickly_payment_method_id[0])
                if (!quickly_payment_method) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('You POS Config active Quickly Paid but not set add Payment Method: ') + this.env.pos.config.quickly_payment_method_id[1] + this.env._t('Payments/ Payment Methods')
                    })
                }
                let paymentLines = selectedOrder.paymentlines.models
                paymentLines.forEach(function (p) {
                    selectedOrder.remove_paymentline(p)
                })
                selectedOrder.add_paymentline(quickly_payment_method);
                var paymentline = selectedOrder.selected_paymentline;
                paymentline.set_amount(selectedOrder.get_total_with_tax());
                selectedOrder.trigger('change', selectedOrder);
                const validate_order_without_receipt = this.env.pos.config.validate_order_without_receipt;
                const iface_print_auto = this.env.pos.config.iface_print_auto;
                this.env.pos.config.validate_order_without_receipt = true
                this.env.pos.config.iface_print_auto = true
                let order_ids = this.env.pos.push_single_order(selectedOrder, {})
                console.log('[quicklyPaidOrder] pushed succeed order_ids: ' + order_ids)
                this.showScreen('ReceiptScreen');
                setTimeout(function () {
                    self.env.pos.config.validate_order_without_receipt = validate_order_without_receipt
                    self.env.pos.config.iface_print_auto = iface_print_auto
                }, 2000)

            }

            async partialPaidOrder() {
                const selectedOrder = this.env.pos.get_order();
                if (selectedOrder.orderlines.length == 0) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Your order cart is blank')
                    })
                }
                const linePriceSmallerThanZero = selectedOrder.orderlines.models.find(l => l.get_price_with_tax() <= 0 && !l.coupon_program_id && !l.promotion)
                if (this.env.pos.config.validate_return && linePriceSmallerThanZero) {
                    let validate = await this.env.pos._validate_action(this.env._t('Have one Line has Price smaller than or equal 0. Need Manager Approve'));
                    if (!validate) {
                        return false;
                    }
                }
                const lineIsCoupon = selectedOrder.orderlines.models.find(l => l.coupon_id || l.coupon_program_id);
                if (lineIsCoupon && this.env.pos.config.validate_coupon) {
                    let validate = await this.env.pos._validate_action(this.env._t('Order add coupon, required need Manager Approve'));
                    if (!validate) {
                        return false;
                    }
                }
                if (this.env.pos.config.validate_payment) {
                    let validate = await this.env.pos._validate_action(this.env._t('Need approve Payment'));
                    if (!validate) {
                        return false;
                    }
                }
                if (selectedOrder.get_total_with_tax() <= 0 || selectedOrder.orderlines.length == 0) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('It not possible with empty cart or Amount Total order smaller than or equal 0')
                    })
                }
                if (!selectedOrder.get_client()) {
                    this.showPopup('ConfirmPopup', {
                        title: this.env._t('Partial Order required Customer'),
                        body: this.env._t('Please set a Customer'),
                        disableCancelButton: true,
                    })
                    const {confirmed, payload: newClient} = await this.showTempScreen(
                        'ClientListScreen',
                        {client: null}
                    );
                    if (confirmed) {
                        selectedOrder.set_client(newClient);
                    } else {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: this.env._t('Required set Customer for Partial Order')
                        })
                    }
                }
                let lists = this.env.pos.payment_methods.filter((p) => (p.journal && p.pos_method_type && p.pos_method_type == 'default') || (!p.journal && !p.pos_method_type)).map((p) => ({
                    id: p.id,
                    item: p,
                    label: p.name
                }))
                let {confirmed, payload: paymentMethod} = await this.showPopup('SelectionPopup', {
                    title: this.env._t('Partial Paid !!! Please Select one Payment Mode and Register one part Amount total of Order'),
                    list: lists
                })
                if (confirmed) {
                    let {confirmed, payload: number} = await this.showPopup('NumberPopup', {
                        title: this.env._t('Register Amount: Please input one part Amount of Amount Total Order'),
                        startingValue: 0
                    })
                    if (confirmed) {
                        number = parseFloat(number)
                        if (number <= 0 || number > selectedOrder.get_total_with_tax()) {
                            return this.showPopup('ErrorPopup', {
                                title: this.env._t('Error'),
                                body: this.env._t('Register Amount required bigger than 0 and smaller than total amount of Order')
                            })
                        }
                        let paymentLines = selectedOrder.paymentlines.models
                        paymentLines.forEach(function (p) {
                            selectedOrder.remove_paymentline(p)
                        })
                        selectedOrder.add_paymentline(paymentMethod);
                        let paymentline = selectedOrder.selected_paymentline;
                        paymentline.set_amount(number);
                        selectedOrder.trigger('change', selectedOrder);
                        let order_ids = this.env.pos.push_single_order(selectedOrder, {
                            draft: true
                        })
                        console.log('{ButtonPartialPayment.js} pushed succeed order_ids: ' + order_ids)
                        this.showScreen('ReceiptScreen');
                        this.showPopup('ConfirmPopup', {
                            title: this.env._t('Succeed !!!'),
                            body: this.env._t('Order save to Draft state, When customer full fill payment please register Payment for Order processing to Paid/Invoice state'),
                            disableCancelButton: true,
                        })
                    }
                }
            }

            async sendInput(key) {
                const selectedOrder = this.env.pos.get_order();
                if (this.env.pos.config.validate_change_minus && key == '-') {
                    let validate = await this.env.pos._validate_action(this.env._t('Requesting change +/- of Line, Please requesting 1 Manager full fill Security PIN'));
                    if (!validate) {
                        return false;
                    }
                }
                if (key == 'ClearCart') {
                    if (selectedOrder.orderlines.models.length > 0) {
                        let {confirmed, payload: result} = await this.showPopup('ConfirmPopup', {
                            title: this.env._t('Warning !!!'),
                            body: this.env._t('Are you want remove all Items in Cart ?')
                        })
                        if (confirmed) {
                            selectedOrder.orderlines.models.forEach(l => selectedOrder.remove_orderline(l))
                            selectedOrder.orderlines.models.forEach(l => selectedOrder.remove_orderline(l))
                            selectedOrder.orderlines.models.forEach(l => selectedOrder.remove_orderline(l))
                            selectedOrder.orderlines.models.forEach(l => selectedOrder.remove_orderline(l))
                            selectedOrder.is_return = false;
                        }
                    } else {
                        this.showPopup('ErrorPopup', {
                            title: this.env._t('Warning !!!'),
                            body: this.env._t('Your Order Cart is blank.')
                        })
                    }

                }
                if (key == 'GlobalDisc') {
                    if (selectedOrder.orderlines.length == 0) {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: this.env._t('Your order cart is blank')
                        })
                    }
                    if (selectedOrder.is_return) {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: this.env._t('It not possible add Global Dicsount for Order Return')
                        })
                    }
                    selectedOrder.clear_discount_extra()
                    const list = this.env.pos.discounts.map(discount => ({
                        id: discount.id,
                        name: discount.name,
                        item: discount,
                    }))
                    let {confirmed, payload: selectedItems} = await this.showPopup(
                        'PopUpSelectionBox',
                        {
                            title: this.env._t('All Global Discount removed, Please select one Disc need Apply ?'),
                            items: list,
                            onlySelectOne: true,
                            cancelButtonText: this.env._t('Close'),
                            confirmButtonText: this.env._t('Confirm'),
                        }
                    );
                    if (confirmed) {
                        selectedOrder.add_global_discount(selectedItems.items[0]['item'])
                    }
                }
                if (key == 'DiscValue') {
                    selectedOrder.clear_discount_extra()
                    if (selectedOrder.orderlines.length == 0) {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: this.env._t('Your order cart is blank')
                        })
                    }
                    let {confirmed, payload: discount} = await this.showPopup('NumberPopup', {
                        title: this.env._t('Which value of discount Value would you apply to Order ? (Click Cancel for reset all Discount Value each Line)'),
                        startingValue: this.env.pos.config.discount_value_limit
                    })
                    if (confirmed) {
                        selectedOrder.set_discount_value(parseFloat(discount))
                    } else {
                        selectedOrder.clear_discount_extra()
                    }
                }
                if (key == 'SetNotes') {
                    const {confirmed, payload: note} = await this.showPopup('TextAreaPopup', {
                        title: this.env._t('Set Notes to Order'),
                        startingValue: selectedOrder.get_note()
                    })
                    if (confirmed) {
                        selectedOrder.set_note(note)
                    }
                }
                if (key == 'PrePrintReceipt') {
                    await this.printReceipt()
                }
                if (key == 'QuicklyPaid') {
                    await this.quicklyPaidOrder()
                }
                if (key == 'PartialPaid') {
                    await this.partialPaidOrder()
                }
                if (key == 'ReturnMode') {
                    await this.changeToReturnMode()
                    this.render()
                }
            }

            get returnStringButton() {
                const selectedOrder = this.env.pos.get_order();
                if (selectedOrder.is_return) {
                    return this.env._t('Return is [On]')
                } else {
                    return this.env._t('Return is [Off]')
                }
            }

            get isReturnOrder() {
                const selectedOrder = this.env.pos.get_order();
                if (selectedOrder.is_return) {
                    return true
                } else {
                    return false
                }
            }

            async changeToReturnMode() {
                const selectedOrder = this.env.pos.get_order();
                if (selectedOrder.picking_type_id) {
                    const pickingType = this.env.pos.stock_picking_type_by_id[selectedOrder.picking_type_id]
                    if (!pickingType['return_picking_type_id']) {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Warning'),
                            body: this.env._t('Your POS [Operation Type]: [ ') + pickingType.name + this.env._t(' ] not set Return Picking Type. Please set it for Return Packing bring stock on hand come back Your POS Stock Location. Operation Type for return required have Default Source Location difference Default Destination Location. Is correctly if Destination Location is your POS stock Location')
                        })
                    }

                }
                if (selectedOrder.is_to_invoice() && !selectedOrder.get_client()) {
                    this.showPopup('ConfirmPopup', {
                        title: this.env._t('Warning'),
                        body: this.env._t('Order will process to Invoice, please select one Customer for set to current Order'),
                        disableCancelButton: true,
                    })
                    const {confirmed, payload: newClient} = await this.showTempScreen(
                        'ClientListScreen',
                        {client: null}
                    );
                    if (confirmed) {
                        selectedOrder.set_client(newClient);
                    } else {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: this.env._t('Order will processing to Invoice, required set a Customer')
                        })
                    }
                }
                if (selectedOrder.is_return) {
                    selectedOrder.orderlines.models.forEach((l) => {
                        if (l.quantity < 0) {
                            l.set_quantity(-l.quantity, 'keep price when return')
                        }
                    })
                    selectedOrder.is_return = false
                    selectedOrder.trigger('change', selectedOrder)
                    return this.showPopup('ConfirmPopup', {
                        title: this.env._t('Successfully'),
                        body: this.env._t('Order change to Normal Mode'),
                        disableCancelButton: true,
                    })
                }
                if (selectedOrder.orderlines.length == 0) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Your order cart is blank')
                    })
                }
                if (this.env.pos.config.validate_return) {
                    let validate = await this.env.pos._validate_action(this.env._t('Need Approve of Your Manager'));
                    if (!validate) {
                        return false;
                    }
                }
                let returnMethod = null;
                if (this.env.pos.config.return_method_id) {
                    returnMethod = this.env.pos.payment_methods.find((p) => this.env.pos.config.return_method_id && p.id == this.env.pos.config.return_method_id[0])
                }
                if (selectedOrder.orderlines.models.length <= 0) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Your shopping cart is empty')
                    })
                }
                let {confirmed, payload: text} = await this.showPopup('TextAreaPopup', {
                    title: this.env._t('Add some notes why customer return products ?'),
                    startingValue: selectedOrder.get_note()
                })
                if (confirmed) {
                    selectedOrder.set_note(text);
                    selectedOrder.orderlines.models.forEach((l) => {
                        if (l.quantity >= 0) {
                            l.set_quantity(-l.quantity, 'keep price when return')
                        }
                    })
                    if (!returnMethod) {
                        return this.showScreen('PaymentScreen');
                    } else {
                        selectedOrder.is_return = true;
                        selectedOrder.paymentlines.models.forEach(function (p) {
                            selectedOrder.remove_paymentline(p)
                        })
                        selectedOrder.add_paymentline(returnMethod);
                        let order_ids = this.env.pos.push_single_order(selectedOrder, {})
                        return this.showScreen('ReceiptScreen');
                    }

                }
            }

        }
    Registries.Component.extend(ActionpadWidget, RetailActionpadWidget);

    return ActionpadWidget;
});
