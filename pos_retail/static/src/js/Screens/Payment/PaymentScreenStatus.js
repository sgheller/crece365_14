odoo.define('pos_retail.PaymentScreenStatus', function (require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const PaymentScreenStatus = require('point_of_sale.PaymentScreenStatus');
    const {useState} = owl.hooks;
    const {useListener} = require('web.custom_hooks');
    const models = require('point_of_sale.models');
    const Registries = require('point_of_sale.Registries');
    var core = require('web.core');
    var _t = core._t;
    var Session = require('web.Session');

    const RetailPaymentScreenStatus = (PaymentScreenStatus) =>
        class extends PaymentScreenStatus {
            constructor() {
                super(...arguments);
            }

            get Client() {
                if (this.env.pos.get_order() && this.env.pos.get_order().get_client()) {
                    return this.env.pos.get_order().get_client();
                } else {
                    return {
                        pos_loyalty_point: 0,
                        balance: 0,
                        wallet: 0,
                    }
                }
            }
        }
    Registries.Component.extend(PaymentScreenStatus, RetailPaymentScreenStatus);

    return RetailPaymentScreenStatus;
});
