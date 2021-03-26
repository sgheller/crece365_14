odoo.define('pos_retail.SyncNotification', function (require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const SyncNotification = require('point_of_sale.SyncNotification');
    const {useState} = owl.hooks;
    const {useListener} = require('web.custom_hooks');
    const models = require('point_of_sale.models');
    const Registries = require('point_of_sale.Registries');

    const RetailSyncNotification = (SyncNotification) =>
        class extends SyncNotification {
            constructor() {
                super(...arguments);
            }

            mounted() {
                super.mounted();
                this.automaticPushOrderToBackEnd()
            }

            async automaticPushOrderToBackEnd() {
                const self = this;
                const ordersInCached = this.env.pos.db.get_orders();
                if (ordersInCached && ordersInCached.length > 0) {
                    console.log('[automaticPushOrderToBackEnd] auto running')
                    await this.env.pos.push_orders(null, {show_error: true}).then(function (order_ids) {
                        setTimeout(_.bind(self.automaticPushOrderToBackEnd, self), 6500);
                        console.log('[automaticPushOrderToBackEnd] saved new order id: ' + order_ids[0])
                    }, function (err) {
                        setTimeout(_.bind(self.automaticPushOrderToBackEnd, self), 6500);
                    });
                } else {
                    setTimeout(_.bind(self.automaticPushOrderToBackEnd, self), 3000);
                }

            }
        }
    Registries.Component.extend(SyncNotification, RetailSyncNotification);

    return RetailSyncNotification;
});
