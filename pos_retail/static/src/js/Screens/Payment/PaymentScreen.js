odoo.define('pos_retail.PaymentScreen', function (require) {
    'use strict';

    const PaymentScreen = require('point_of_sale.PaymentScreen');
    const {useListener} = require('web.custom_hooks');
    const Registries = require('point_of_sale.Registries');
    var core = require('web.core');
    var _t = core._t;
    var Session = require('web.Session');
    const {posbus} = require('point_of_sale.utils');
    var BarcodeEvents = require('barcodes.BarcodeEvents').BarcodeEvents;
    const NumberBuffer = require('point_of_sale.NumberBuffer');
    const {useState} = owl.hooks;

    const RetailPaymentScreen = (PaymentScreen) =>
        class extends PaymentScreen {
            constructor() {
                super(...arguments);
                useListener('reference-payment-line', this.setReferencePayment);
                useListener('cheque-tracking-payment-line', this.setChequeTrackingPaymentLine);
                useListener('click-journal', this.setJournal);
                useListener('click-coin', this.setCoin);
                this.buffered_key_events = []
                this._onKeypadKeyDown = this._onKeypadKeyDown.bind(this);
                useListener('show-popup', this.removeEventKeyboad);
                this._currentOrder = this.env.pos.get_order();
                this._currentOrder.orderlines.on('change', this.render, this);
                this.state = useState({showAllMethods: true});
            }

            mounted() {
                super.mounted();
                posbus.on('closed-popup', this, this.addEventKeyboad);
                if (this.props.autoValidateOrder) {
                    return this.validateOrder(false)
                }
                this.addEventKeyboad()
            }

            OnChangeNote(event) {
                const newNote = event.target.value;
                if (this._currentOrder) {
                    this._currentOrder.set_note(newNote)
                }
            }


            get showAllPaymentMethodLabel() {
                if (!this.state.showAllMethods) {
                    return this.env._t('Show All Payment Method')
                } else {
                    return this.env._t('Only Show Base Payment Method')
                }
            }

            showAllPaymentMethods() {
                this.state.showAllMethods = !this.state.showAllMethods;
            }

            get PaymentMethods() {
                const selectedOrder = this._currentOrder;
                if (!selectedOrder) {
                    return []
                } else {
                    if (this.state.showAllMethods) {
                        return this.env.pos.payment_methods
                    }
                    const selectedCurrency = selectedOrder.currency
                    let paymentMethods = []
                    if (selectedCurrency) {
                        this.env.pos.normal_payment_methods.forEach(p => {
                            if (!p.journal || (p.journal && !p.journal.currency_id) || (p.journal && p.journal.currency_id && p.journal.currency_id[0] == selectedCurrency['id'])) {
                                paymentMethods.push(p)
                            }
                        })
                        return paymentMethods
                    } else {
                        return this.env.pos.normal_payment_methods
                    }
                }
            }

            deletePaymentLine(event) {
                const {cid} = event.detail;
                const line = this.paymentLines.find((line) => line.cid === cid);

                // If a paymentline with a payment terminal linked to
                // it is removed, the terminal should get a cancel
                // request.
                if (['waiting', 'waitingCard', 'timeout'].includes(line.get_payment_status())) {
                    line.payment_method.payment_terminal.send_payment_cancel(this.currentOrder, cid);
                }

                this.currentOrder.remove_paymentline(line);
                NumberBuffer.reset();
                this.render();
            }

            async _finalizeValidation() { // some pos setting iface_cashdrawer is true but not set proxy_ip
                if (!this.env.pos.proxy.printer) {
                    this.env.pos.config.iface_cashdrawer = false
                }
                super._finalizeValidation();
            }

            async addNewPaymentLine({detail: paymentMethod}) {
                if (this.currentOrder && paymentMethod && paymentMethod['is_pax'] && paymentMethod['pax_id']) {
                    let waitingPaxRespon = await this.waitingPaxPayment(paymentMethod)
                    if (!waitingPaxRespon) {
                        return false;
                    }
                }
                super.addNewPaymentLine({detail: paymentMethod});
                this.env.pos.trigger('update:customer-facing-screen');
                const selected_paymentline = this.currentOrder.selected_paymentline;
                if (paymentMethod && paymentMethod['cheque_bank_information'] && selected_paymentline) {
                    this.setChequeTrackingPaymentLine({
                        detail: {
                            cid: selected_paymentline['cid']
                        }
                    })
                }
                if (paymentMethod && paymentMethod['is_pax'] && paymentMethod['pax_id'] && selected_paymentline) {
                    selected_paymentline.set_amount(0)
                }
            }

            async waitingPaxPayment(paymentMethod) {
                /*
                    'transactionIno': {
                        'transactionType': '01'
                        # Auth - 03
                        # Sale - 01
                        # Return - 02
                        # Void - 16
                        # PostAuth - 04
                        # ForceAuth - 05
                        # Adjust - 06
                        # Verify - 24
                    },
                */
                const self = this;
                let dueAmount = this.currentOrder.get_due()
                if (dueAmount == 0) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Due Amount required not 0')
                    })
                }
                let transactionType = "01" // default is sale
                const posParameter = {
                    'command': 'T00',
                    'versionNo': '1.28',
                    'transactionIno': {
                        'transactionType': transactionType
                    },
                    'amountInfo': {
                        'tranasctionAmount': '',
                        'tipAmount': '',
                        'cashBack': '',
                        'merchantFee': '',
                        'tax': '',
                        'fuelAmount': ''
                    },
                    'accountInfo': '',
                    'traceInfo': {
                        'refNo': '1',
                        'invoiceNo': '',
                        'authCode': '',
                        'transscationNo': '',
                        'timeStamp': '',
                        'ecrTranID': ''
                    },
                    'avsInfo': '',
                    'cashInfo': {
                        'clerkID': '',
                        'shiftID': ''
                    },
                    'commercialInfo': {
                        'poNo': '',
                        'customerCode': '',
                        'taxExempt': '',
                        'taxExemptID': '',
                        'merchantTaxID': '',
                        'destinationZipCode': '',
                        'productDescription': ''
                    },
                    'motoEco': {
                        'commerceMode': '',
                        'transactionType': '',
                        'secureType': '',
                        'orderNo': '',
                        'installments': '',
                        'currentInstall': ''
                    },
                    'additionalInfo': ''
                }
                if (dueAmount == 0) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Warning'),
                        body: this.env._t('Order full fill Total Amount')
                    })
                }
                if (dueAmount < 0) {
                    transactionType = "02"
                    posParameter['transactionIno']['transactionType'] = transactionType // is return
                }
                let tipAmount = 0
                if (dueAmount > 0 && this.env.pos.config.tip_product_id) {
                    const tipsLine = this.currentOrder.orderlines.models.filter(p => p.product.id == this.env.pos.config.tip_product_id[0])
                    if (tipsLine.length > 0) {
                        tipsLine.forEach(t => {
                            tipAmount += t.get_price_with_tax()
                        })
                        tipAmount = (parseInt(tipAmount * 100)).toString().replace('.').replace(',')
                        posParameter['amountInfo']['tipAmount'] = tipAmount
                    }
                }
                if (dueAmount < 0) {
                    dueAmount = -dueAmount
                }
                let amountString = (parseInt(dueAmount * 100)).toString().replace('.').replace(',')
                posParameter['amountInfo']['tranasctionAmount'] = amountString
                let codePayment = await this.rpc({
                    model: 'pax.terminal',
                    method: 'encodeValue',
                    args: [[], posParameter],
                    context: {}
                });
                if (!codePayment) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Your Odoo Server Offline mode or your internet has problem. Please check')
                    })
                }
                if (transactionType == "01") {
                    this.showPopup('ConfirmPopup', {
                        title: self.env._t("You have 30 Seconds for Insert the Customer's Card to PAX Device"),
                        body: this.env._t("Will charge Customer's card with Amount: ") + this.env.pos.format_currency(dueAmount),
                    })
                }
                if (transactionType == "02") {
                    this.showPopup('ConfirmPopup', {
                        title: self.env._t("You have 30 Seconds for Insert the Customer's Card to PAX Device"),
                        body: this.env._t("Will refund back Customer's card with Amount: ") + this.env.pos.format_currency(dueAmount),
                    })
                }
                const pax = this.env.pos.pax_by_id[paymentMethod.pax_id[0]]
                const paxLink = 'http://' + pax.ip_addr + ':' + pax.protocol + '/?' + codePayment
                this.HttpCommunication('DoCredit', paxLink, function (response) {
                    if (response && response.length >= 6 && response[5] != 'TIMEOUT') {
                        if (transactionType == "01") {
                            self.currentOrder.add_paymentline(paymentMethod);
                            let selectedPaymentline = self.currentOrder.selected_paymentline;
                            selectedPaymentline.set_amount(dueAmount)
                        }
                        self.validateOrder(false)
                    }
                    if (response && response.length >= 6 && response[5] == 'TIMEOUT') {
                        return self.showPopup('ErrorPopup', {
                            title: self.env._t('Error'),
                            body: self.env._t("Timeout Scan Customer's Card, please try again click to ") + paymentMethod.name + self.env._t(". And scan customer's card again")
                        })
                    }
                    console.log(response)
                    self.trigger('close-popup')
                }, 30000);
            }

            StringToHex(response) {
                var responseHex = "";
                for (var i = 0; i < response.length; i++) {
                    if (responseHex == "")
                        responseHex = response.charCodeAt(i).toString(16).length < 2 ? '0' + response.charCodeAt(i).toString(16) : response.charCodeAt(i).toString(16);
                    else
                        responseHex += response.charCodeAt(i).toString(16).length < 2 ? " " + '0' + response.charCodeAt(i).toString(16) : " " + response.charCodeAt(i).toString(16);
                }
                return responseHex;

            }

            base64ToHex(str) {
                for (var i = 0, bin = $.base64.atob(str), hex = []; i < bin.length; ++i) {
                    var tmp = bin.charCodeAt(i).toString(16);
                    if (tmp.length === 1) tmp = "0" + tmp;
                    hex[hex.length] = tmp;
                }
                return hex.join(" ");
            }


            HexToString(response) {
                var responseHex = "";
                var arr = response.split(" ");
                for (var i = 0; i < arr.length; i++) {
                    if (arr[i] == "")
                        continue;
                    responseHex += String.fromCharCode(parseInt(arr[i], 16));
                }
                return responseHex;
            }

            //Get LRC
            getLRC(params) {
                var lrc = 0;
                for (let i = 1; i < params.length; i++) {
                    var type_of = typeof (params[i]);
                    if (type_of == "string") {
                        var element = params[i].split("");
                        for (let ii = 0; ii < element.length; ii++) {
                            lrc ^= element[ii].charCodeAt(0);
                        }
                    } else {
                        lrc ^= params[i];
                    }
                }
                return (lrc > 0) ? String.fromCharCode(lrc) : 0;
            }

            HttpCommunication(commandType, url, callback, timeout) {
                var xhr = null;
                const self = this;
                if (window.XMLHttpRequest) {
                    xhr = new XMLHttpRequest();
                } else {
                    try {
                        xhr = new ActiveXObject('Microsoft.XMLHttp');
                    } catch (e) {
                        xhr = new ActiveXObject('msxml2.xmlhttp');
                    }
                }
                xhr.open("GET", url, true);
                xhr.onreadystatechange = function () {
                    console.log('xhr.readyState: ' + xhr.readyState)
                    if (xhr.readyState == 4) {
                        console.log('xhr.status: ' + xhr.status)
                        if (xhr.status == 200) {
                            var response = xhr.responseText;
                            console.log("Raw response: " + response);

                            var checkParams = self.StringToHex(response).split(" ").pop();
                            var RedundancyCheck = self.StringToHex(response).split(" ").pop().substring(1);

                            var check = self.getLRC(checkParams);

                            if (check == RedundancyCheck) {
                                //get package detail info
                                var packetInfo = [];
                                var len = self.StringToHex(response).indexOf("03");
                                var hex = self.StringToHex(response).slice(0, len).split(/02|1c/);

                                console.log(hex);
                                if (commandType == "DoCredit") {
                                    var subHex = [], subPacketInfo = [];
                                    for (var i = 0; i < hex.length; i++) {
                                        if (hex[i] != "") {
                                            if (hex[i].indexOf("1f") > 0) {
                                                subHex = hex[i].split("1f");
                                                console.log(subHex);
                                                subPacketInfo = [];
                                                for (var j = 0; j < subHex.length; j++) {
                                                    if (subHex[j] != '') {
                                                        subPacketInfo.push(self.HexToString(subHex[j]));
                                                    }
                                                }
                                                console.log(subPacketInfo);
                                                packetInfo.push(subPacketInfo);
                                            } else {
                                                packetInfo[i] = self.HexToString(hex[i]);
                                            }
                                        }
                                    }

                                } else {
                                    for (var i = 0; i < hex.length; i++) {
                                        if (hex[i] != "") {
                                            packetInfo[i] = self.HexToString(hex[i]);
                                        }
                                    }
                                }

                                console.log("Separate package info: ");
                                console.log(packetInfo);
                                callback(packetInfo);
                            }
                        } else {
                            self.showPopup('ErrorPopup', {
                                title: self.env._t('Error Connect with PAX Terminal Device !!!'),
                                body: self.env._t('Please checking Pax Device Online or Offline, Ip address and Protocol of Pax Device setting, Code Status of request Pax Device: ') + xhr.status
                            })
                        }
                    }
                };
                xhr.send(null);
            }

            _updateSelectedPaymentline() {
                super._updateSelectedPaymentline();
                this.env.pos.trigger('update:customer-facing-screen');
            }

            deletePaymentLine(event) {
                super.deletePaymentLine(event);
                this.env.pos.trigger('update:customer-facing-screen');
                console.log('[deletePaymentLine] deleted payment line')
            }

            selectPaymentLine(event) {
                super.selectPaymentLine(event);
                this.env.pos.trigger('update:customer-facing-screen');
            }

            removePayments() {
                const self = this;
                this.currentOrder.paymentlines.models.forEach(function (p) {
                    self.currentOrder.remove_paymentline(p)
                })
                this.currentOrder.paymentlines.models.forEach(function (p) {
                    self.currentOrder.remove_paymentline(p)
                })
                this.currentOrder.paymentlines.models.forEach(function (p) {
                    self.currentOrder.remove_paymentline(p)
                })
                this.currentOrder.trigger('change', this.currentOrder)
            }

            willUnmount() {
                super.willUnmount();
                posbus.off('closed-popup', this, null);
                this.removeEventKeyboad()
            }

            addEventKeyboad() {
                console.log('add event keyboard')
                $(document).off('keydown.productscreen', this._onKeypadKeyDown);
                $(document).on('keydown.productscreen', this._onKeypadKeyDown);
            }

            removeEventKeyboad() {
                console.log('remove event keyboard')
                $(document).off('keydown.productscreen', this._onKeypadKeyDown);
            }

            _onKeypadKeyDown(ev) {
                if (!_.contains(["INPUT", "TEXTAREA"], $(ev.target).prop('tagName'))) {
                    clearTimeout(this.timeout);
                    this.buffered_key_events.push(ev);
                    this.timeout = setTimeout(_.bind(this._keyboardHandler, this), BarcodeEvents.max_time_between_keys_in_ms);
                }
                if (ev.keyCode == 27) {  // esc key
                    this.buffered_key_events.push(ev);
                    this.timeout = setTimeout(_.bind(this._keyboardHandler, this), BarcodeEvents.max_time_between_keys_in_ms);
                }
            }

            _keyboardHandler() {
                if (this.buffered_key_events.length > 3) {
                    this.buffered_key_events = [];
                    return true;
                }
                for (let i = 0; i < this.buffered_key_events.length; i++) {
                    let event = this.buffered_key_events[i]
                    console.log(event.keyCode)
                    // -------------------------- product screen -------------
                    let key = '';
                    if (event.keyCode == 13 || event.keyCode == 39) { // enter or arrow right
                        $(this.el).find('.next').click()
                    }
                    if (event.keyCode == 66 || event.keyCode == 27) { // b
                        $(this.el).find('.back').click()
                    }
                    if (event.keyCode == 67) { // c
                        this.removePayments()
                    }
                    if (event.keyCode == 82) { // r
                        let selectedPaymentline = this.currentOrder.selected_paymentline
                        if (selectedPaymentline) {
                            this.currentOrder.remove_paymentline(selectedPaymentline)
                            if (this.currentOrder.paymentlines.models.length > 0) {
                                this.currentOrder.select_paymentline(this.currentOrder.paymentlines.models[0]);
                            }
                            NumberBuffer.reset()
                            this.render()
                        }
                    }
                    if (event.keyCode == 38 || event.keyCode == 40) { // arrow up
                        let selectedPaymentline = this.currentOrder.selected_paymentline
                        if (selectedPaymentline) {
                            for (let i = 0; i < this.currentOrder.paymentlines.models.length; i++) {
                                let line = this.currentOrder.paymentlines.models[i]
                                if (line.cid == selectedPaymentline.cid) {
                                    let payment_number = null;
                                    if (event.keyCode == 38) { // up
                                        if (i == 0) {
                                            payment_number = this.currentOrder.paymentlines.models.length - 1
                                        } else {
                                            payment_number = i - 1
                                        }
                                    } else { // down
                                        if (i + 1 >= this.currentOrder.paymentlines.models.length) {
                                            payment_number = 0
                                        } else {
                                            payment_number = i + 1
                                        }
                                    }
                                    console.log(payment_number)
                                    this.currentOrder.select_paymentline(this.currentOrder.paymentlines.models[payment_number]);
                                    NumberBuffer.reset()
                                    this.render()
                                    break;
                                }
                            }
                        } else {
                            if (this.currentOrder.paymentlines.models.length >= 1) {
                                this.currentOrder.select_paymentline(this.currentOrder.paymentlines.models[0]);
                                NumberBuffer.reset()
                                this.render()
                            }
                        }
                    }
                    if (event.key) {
                        const line = this.paymentLines.find((line) => line.payment_method && line.payment_method.shortcut_keyboard === event.key);
                        if (line) {
                            this.currentOrder.select_paymentline(line);
                            NumberBuffer.reset();
                            this.render();
                        } else {
                            const paymentMethod = this.env.pos.payment_methods.find((p) => p.shortcut_keyboard && p.shortcut_keyboard === event.key)
                            if (paymentMethod) {
                                this.currentOrder.add_paymentline(paymentMethod);
                                this.render()
                            }
                        }
                    }
                }
                this.buffered_key_events = [];
            }

            setCoin(event) {
                let selectedOrder = this.currentOrder;
                let selectedPaymentline = selectedOrder.selected_paymentline
                if ((!selectedPaymentline) || (selectedPaymentline.payment_method && selectedPaymentline.payment_method.pos_method_type != 'default')) {
                    let cashMethod = this.env.pos.normal_payment_methods.find((p) => p.journal && p.pos_method_type == 'default' && p.is_cash_count)
                    if (!cashMethod) {
                        this.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: this.env._t(
                                'Cash method not found in your pos !'
                            ),
                        });
                    } else {
                        this.currentOrder.add_paymentline(cashMethod);
                        selectedPaymentline = this.currentOrder.selected_paymentline;
                        selectedPaymentline.set_amount(event.detail.amount);
                    }
                } else {
                    selectedPaymentline.set_amount(selectedPaymentline.amount + event.detail.amount);
                }
                this.currentOrder.trigger('change', this.currentOrder);
            }

            setJournal(event) {
                let selectedOrder = this.currentOrder;
                selectedOrder.payment_journal_id = event.detail.id
                selectedOrder.trigger('change', selectedOrder);
            }

            async setReferencePayment(event) {
                const {cid} = event.detail;
                const line = this.paymentLines.find((line) => line.cid === cid);
                let {confirmed, payload: ref} = await this.showPopup('TextInputPopup', {
                    title: this.env._t('Alert, please set Payment Reference'),
                    startingValue: line.payment_reference || ''
                })
                if (confirmed) {
                    line.set_reference(ref);
                    this.render()
                }
            }

            async setChequeTrackingPaymentLine(event) {
                const {cid} = event.detail;
                const line = this.paymentLines.find((line) => line.cid === cid);
                let {confirmed, payload: datas} = await this.showPopup('PopUpSetChequePaymentLine', {
                    title: this.env._t('Set Cheque Bank Information'),
                    cheque_owner: line.cheque_owner,
                    cheque_bank_id: line.cheque_bank_id,
                    cheque_bank_account: line.cheque_bank_account,
                    cheque_check_number: line.cheque_check_number,
                    cheque_card_name: line.cheque_card_name,
                    cheque_card_number: line.cheque_card_number,
                    cheque_card_type: line.cheque_card_type,
                })
                if (confirmed) {
                    line.cheque_card_name = datas['cheque_card_name']
                    line.cheque_card_number = datas['cheque_card_number']
                    line.cheque_card_type = datas['cheque_card_type']
                    line.cheque_bank_account = datas['cheque_bank_account']
                    line.cheque_bank_id = parseInt(datas['cheque_bank_id'])
                    line.cheque_check_number = datas['cheque_check_number']
                    line.cheque_owner = datas['cheque_owner']
                    line.trigger('change', line)
                }
            }

            async _isOrderValid() {
                const self = this;
                if (this.currentOrder) {
                    let totalWithTax = this.currentOrder.get_total_with_tax();
                    if (!this.env.pos.config.allow_payment_zero && totalWithTax == 0) {
                        this.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: this.env._t(
                                'Your POS Locked payment order with Amount Total is 0'
                            ),
                        });
                        return false;
                    }
                }
                if (this.env.pos.config.validate_payment) {
                    let validate = await this.env.pos._validate_action(this.env._t('Need approve Payment'));
                    if (!validate) {
                        return false;
                    }
                }
                const linePriceSmallerThanZero = this.currentOrder.orderlines.models.find(l => l.get_price_with_tax() <= 0 && !l.coupon_program_id && !l.promotion)
                if (this.env.pos.config.validate_return && linePriceSmallerThanZero) {
                    let validate = await this.env.pos._validate_action(this.env._t('Have one Line price smaller than or equal 0. Please check'));
                    if (!validate) {
                        return false;
                    }
                }

                const lineIsAmountSmallerThanZeroAndProductTypeIsConsu = this.currentOrder.orderlines.models.find(l => l.product.type == 'consu' && l.get_price_with_tax() <= 0 && !l.coupon_program_id && !l.promotion)
                if (lineIsAmountSmallerThanZeroAndProductTypeIsConsu && this.currentOrder.picking_type_id) {
                    const pickingType = this.env.pos.stock_picking_type_by_id[selectedOrder.picking_type_id]
                    if (!pickingType['return_picking_type_id']) {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Warning'),
                            body: this.env._t('Your POS [Operation Type]: [ ') + pickingType.name + this.env._t(' ] not set Return Picking Type. Please set it for Return Packing bring stock on hand come back Your POS Stock Location. Operation Type for return required have Default Source Location difference Default Destination Location. Is correctly if Destination Location is your POS stock Location')
                        })
                        return false
                    }
                }
                const lineIsCoupon = this.currentOrder.orderlines.models.find(l => l.coupon_id || l.coupon_program_id);
                if (lineIsCoupon && this.env.pos.config.validate_coupon) {
                    let validate = await this.env.pos._validate_action(this.env._t('Order add coupon, required need Manager Approve'));
                    if (!validate) {
                        return false;
                    }
                }
                const isValid = await super._isOrderValid()
                if (isValid) {
                    this.currentOrder.orderlines.models.forEach(l => {
                        if (l.product.type == 'product' && self.env.pos.db.stock_datas[l.product.id]) {
                            self.env.pos.db.stock_datas[l.product.id] = self.env.pos.db.stock_datas[l.product.id] - l.quantity
                        }
                    })
                    const paxPayments = this.currentOrder.paymentlines.models.filter(p => p.payment_method && p.payment_method['is_pax'] && p.payment_method['pax_id'])
                    if (this.currentOrder.get_total_with_tax() < 0 && paxPayments && paxPayments.length != 0) {
                        return isValid // todo: if payment via pax, not need check bellow
                    }
                    if (this.currentOrder.get_total_with_tax() < 0 && this.env.pos.config.return_covert_to_coupon && this.env.pos.config.return_coupon_program_id) {
                        let {confirmed, payload: confirming} = await this.showPopup('ConfirmPopup', {
                            title: this.env._t('Are you want Covert Refund Amount: ') + this.env.pos.format_currency(-this.currentOrder.get_total_with_tax()) + this.env._t(' to Coupon for next Order'),
                            body: this.env._t('Coupon Amount can use any Times, any next Orders') + this.env.pos.format_currency(-this.currentOrder.get_total_with_tax())
                        })
                        if (confirmed) {
                            if (this.currentOrder.get_paymentlines().length > 0) {
                                this.currentOrder.paymentlines.models.forEach(function (p) {
                                    self.currentOrder.remove_paymentline(p)
                                })
                            }
                            let partner_id = null;
                            if (this.currentOrder.get_client()) {
                                partner_id = this.currentOrder.get_client().id
                            }
                            let couponValue = await this.rpc({
                                model: 'coupon.generate.wizard',
                                method: 'covert_return_order_to_giftcards',
                                args: [[], this.env.pos.config.return_coupon_program_id[0], -this.currentOrder.get_total_with_tax(), partner_id, this.env.pos.config.id, this.currentOrder.name],
                            }, {
                                shadow: true,
                                timeout: 65000
                            })
                            this.currentOrder['coupon_code'] = couponValue.coupon_code
                            await this.env.pos.do_action('coupon.report_coupon_code', {
                                additional_context: {
                                    active_id: couponValue['coupon_id'],
                                    active_ids: [couponValue['coupon_id']],
                                }
                            });
                        } else {
                        }
                    }
                }
                if (this.env.pos.config.warning_odoo_offline) {
                    const iot_url = this.env.pos.session.origin;
                    const connection = new Session(void 0, iot_url, {
                        use_cors: true
                    });
                    let pingServer = await connection.rpc('/pos/passing/login', {}).then(function (result) {
                        return result
                    }, function (error) {
                        return false;
                    })
                    if (!pingServer) {
                        let {confirmed, payload: result} = await this.showPopup('ErrorPopup', {
                            title: this.env._t('Warning'),
                            body: this.env._t('Your Internet or Odoo Server Offline. Could not finish Order.'),
                            confirmText: this.env._t('Force Send Order'),
                            cancelText: this.env._t('Waiting Online Back')
                        });
                        if (confirmed) {
                            return isValid
                        } else {
                            return false;
                        }
                    }
                }
                return isValid
            }

            async scanVoucher() {
                const due = this.currentOrder.get_due();
                if (due <= 0) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Order full fill amount, can not use Voucher')
                    })
                }
                const {confirmed, payload} = await this.showPopup('TextInputPopup', {
                    title: _t('Scan Voucher'),
                    body: _t('Please input voucher code'),
                    startingValue: 0,
                });
                if (confirmed) {
                    let code = payload
                    if (code) {
                        let voucher = await this.env.pos.rpc({
                            model: 'pos.voucher',
                            method: 'get_voucher_by_code',
                            args: [code],
                        })
                        if (voucher == -1) {
                            this.showPopup('ErrorPopup', {
                                title: _t('Error'),
                                body: _t('Voucher not found'),
                            })
                        } else {
                            var order = this.env.pos.get_order();
                            if (order) {
                                order.client_use_voucher(voucher)
                            }
                        }
                    } else {
                        this.env.pos.alert_message({
                            title: _t('Alert'),
                            body: _t('Code not found'),
                        })
                    }
                } else {
                    this.env.pos.alert_message({
                        title: _t('Alert'),
                        body: _t('Please select one product'),
                    })
                }
            }

            async selectLoyaltyReward() {
                var client = this.currentOrder.get_client();
                if (!client) {
                    const {confirmed, payload: newClient} = await this.env.pos.chrome.showTempScreen(
                        'ClientListScreen',
                        {client: null}
                    );
                    if (confirmed) {
                        this.currentOrder.set_client(newClient);
                    } else {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: this.env._t('Required select customer for checking customer points')
                        })
                    }

                }
                const list = this.env.pos.rewards.map(reward => ({
                    id: reward.id,
                    label: reward.name,
                    isSelected: false,
                    item: reward
                }))
                let {confirmed, payload: reward} = await this.env.pos.chrome.showPopup('SelectionPopup', {
                    title: _t('Please select one Reward need apply to customer'),
                    list: list,
                });
                if (confirmed) {
                    this.currentOrder.set_reward_program(reward)
                }
            }

            async saveToWallet() {
                const due = this.currentOrder.get_due();
                if (due >= 0) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Order have not change amount for save to Wallet')
                    })
                }
                let self = this;
                let walletMethod = this.env.pos.payment_methods.find((p) => p.journal && p.pos_method_type == 'wallet')
                let changeAmount = this.currentOrder.get_change();
                if (!walletMethod) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Your pos have not add Wallet Payment Method, please go to Journal create one Wallet journal with method type is wallet, and create one Payment Method type wallet link to this Journal Wallet')
                    })
                }
                if (changeAmount <= 0) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Change amount not found, it not possible add to Wallet. Required change amount bigger than 0')
                    })
                }
                if (!this.currentOrder.get_client()) {
                    const {confirmed, payload: newClient} = await this.showTempScreen(
                        'ClientListScreen',
                        {client: null}
                    );
                    if (confirmed) {
                        this.currentOrder.set_client(newClient);
                    } else {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Alert'),
                            body: this.env._t('Required choice Customer')
                        })
                    }
                }
                let {confirmed, payload: number} = await this.showPopup('NumberPopup', {
                    title: this.env._t('Which wallet amount save to Wallet of Customer ?'),
                    startingValue: changeAmount
                })
                if (confirmed) {
                    if (number > changeAmount) {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: this.env._t('Amount save to Wallet not possible bigger than amount change')
                        })
                    }
                    let paymentLines = this.currentOrder.paymentlines.models
                    paymentLines.forEach(function (p) {
                        if (p.payment_method && p.payment_method.journal && p.payment_method.pos_method_type == 'wallet') {
                            self.currentOrder.remove_paymentline(p)
                        }
                    })
                    this.currentOrder.add_paymentline(walletMethod);
                    let paymentline = this.currentOrder.selected_paymentline;
                    paymentline.set_amount(-(parseFloat(number)));
                    this.currentOrder.trigger('change', this.currentOrder);
                }

            }

            get customerHasWallet() {
                if (this.currentOrder.get_client() && this.currentOrder.get_client().wallet > 0) {
                    return true
                } else {
                    return false
                }
            }

            async useWalletPaid() {
                let self = this;
                let amountDue = this.currentOrder.get_total_with_tax() + this.currentOrder.get_rounding_applied()
                let startingValue = 0;
                let clientWallet = this.currentOrder.get_client().wallet
                let walletMethod = this.env.pos.payment_methods.find((p) => p.journal && p.pos_method_type == 'wallet')
                if (!walletMethod) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Your pos have not add Wallet Payment Method, please go to Journal create one Wallet journal with method type is wallet, and create one Payment Method type wallet link to this Journal Wallet')
                    })
                }
                if (!this.currentOrder.get_client()) {
                    const {confirmed, payload: newClient} = await this.showTempScreen(
                        'ClientListScreen',
                        {client: null}
                    );
                    if (confirmed) {
                        this.currentOrder.set_client(newClient);
                    } else {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Alert'),
                            body: this.env._t('Required choice Customer')
                        })
                    }
                }
                if (clientWallet >= amountDue) {
                    startingValue = amountDue
                } else {
                    startingValue = clientWallet
                }
                let {confirmed, payload: number} = await this.showPopup('NumberPopup', {
                    title: this.env._t('Maximum Wallet Customer can add :') + this.env.pos.format_currency(startingValue),
                    startingValue: startingValue
                })
                if (confirmed) {
                    if (number > clientWallet) {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: this.env._t('Wallet amount just input required smaller than or equal wallet points customer have: ') + this.currentOrder.get_order().wallet
                        })
                    }
                    if (number > amountDue) {
                        number = amountDue
                    }
                    let paymentLines = this.currentOrder.paymentlines.models
                    paymentLines.forEach(function (p) {
                        if (p.payment_method && p.payment_method.journal && p.payment_method.pos_method_type == 'wallet') {
                            self.currentOrder.remove_paymentline(p)
                        }
                    })
                    this.currentOrder.add_paymentline(walletMethod);
                    let paymentline = this.currentOrder.selected_paymentline;
                    paymentline.set_amount((parseFloat(number)));
                    this.currentOrder.trigger('change', this.currentOrder);
                }

            }

            get customerHasCredit() {
                if (this.currentOrder.get_client() && this.currentOrder.get_client().balance > 0) {
                    return true
                } else {
                    return false
                }
            }

            async useCreditPaid() {
                let self = this;
                let amountDue = this.currentOrder.get_total_with_tax() + this.currentOrder.get_rounding_applied()
                let startingValue = 0;
                let clientCredit = this.currentOrder.get_client().balance
                let creditMethod = this.env.pos.payment_methods.find((p) => p.journal && p.pos_method_type == 'credit')
                if (!creditMethod) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Your pos have not add Wallet Payment Method, please go to Journal create one Wallet journal with method type is wallet, and create one Payment Method type wallet link to this Journal Wallet')
                    })
                }
                if (amountDue <= 0) {
                    return this.showPopup('ErrorPopup', {
                        title: this.env._t('Error'),
                        body: this.env._t('Due amount required bigger than 0')
                    })
                }
                if (!this.currentOrder.get_client()) {
                    const {confirmed, payload: newClient} = await this.showTempScreen(
                        'ClientListScreen',
                        {client: null}
                    );
                    if (confirmed) {
                        this.currentOrder.set_client(newClient);
                    } else {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Alert'),
                            body: this.env._t('Required choice Customer')
                        })
                    }
                }
                if (clientCredit >= amountDue) {
                    startingValue = amountDue
                } else {
                    startingValue = clientCredit
                }
                let {confirmed, payload: number} = await this.showPopup('NumberPopup', {
                    title: this.env._t('Maximum Credit Customer can add :') + this.env.pos.format_currency(startingValue),
                    startingValue: startingValue
                })
                if (confirmed) {
                    if (number > clientCredit) {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Error'),
                            body: this.env._t('Credit amount just input required smaller than or equal credit points customer have: ') + clientCredit
                        })
                    }
                    if (number > amountDue) {
                        number = amountDue
                    }
                    let paymentLines = this.currentOrder.paymentlines.models
                    paymentLines.forEach(function (p) {
                        if (p.payment_method && p.payment_method.journal && p.payment_method.pos_method_type == 'credit') {
                            self.currentOrder.remove_paymentline(p)
                        }
                    })
                    this.currentOrder.add_paymentline(creditMethod);
                    let paymentline = this.currentOrder.selected_paymentline;
                    paymentline.set_amount((parseFloat(number)));
                    this.currentOrder.trigger('change', this.currentOrder);
                }

            }


        }
    Registries.Component.extend(PaymentScreen, RetailPaymentScreen);

    return RetailPaymentScreen;
});
