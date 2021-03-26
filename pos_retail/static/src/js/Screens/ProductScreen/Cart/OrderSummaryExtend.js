odoo.define('pos_retail.OrderSummaryExtend', function (require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const Registries = require('point_of_sale.Registries');

    class OrderSummaryExtend extends PosComponent {
        constructor() {
            super(...arguments);
        }

        get order() {
            return this.env.pos.get_order();
        }

        get client() {
            return this.env.pos.get_order().get_client();
        }

        get promotions() {
            let order = this.env.pos.get_order();
            return order.get_promotions_active()['promotions_active']
        }

        showSummaryExtend() {
            this.env.pos.showSummaryExtend = !this.env.pos.showSummaryExtend
            this.render()
        }

    }

    OrderSummaryExtend.template = 'OrderSummaryExtend';

    Registries.Component.add(OrderSummaryExtend);

    return OrderSummaryExtend;
});
