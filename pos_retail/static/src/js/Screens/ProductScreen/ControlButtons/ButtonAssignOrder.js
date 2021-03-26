odoo.define('pos_retail.ButtonAssignOrder', function (require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const ProductScreen = require('point_of_sale.ProductScreen');
    const {useListener} = require('web.custom_hooks');
    const Registries = require('point_of_sale.Registries');

    class ButtonAssignOrder extends PosComponent {
        constructor() {
            super(...arguments);
            useListener('click', this.onClick);
        }

        get isHighlighted() {
            return true
        }

        mounted() {
            this.env.pos.get('orders').on('add remove change', () => this.render(), this);
            this.env.pos.on('change:selectedOrder', () => this.render(), this);
        }
        willUnmount() {
            this.env.pos.get('orders').off('add remove change', null, this);
            this.env.pos.off('change:selectedOrder', null, this);
        }

        async onClick() {
            var self = this;
            let selectedOrder = this.env.pos.get_order();
            if (selectedOrder.orderlines.length == 0) {
                return this.showPopup('ErrorPopup', {
                    title: this.env._t('Warning'),
                    body: this.env._t('Your order is blank cart'),
                })
            }
            let sessions = await this.rpc({
                model: 'pos.session',
                method: 'search_read',
                domain: [['state', '=', 'opened'], ['config_id', 'in', this.env.pos.config.assign_orders_to_config_ids]],
                fields: ['name', 'user_id', 'config_id', 'start_at', 'id']
            }).then(function (sessions) {
                return sessions
            }, function (err) {
                return self.env.pos.query_backend_fail(err);
            })
            const list = sessions.map(session => ({
                id: session.id,
                label: session.name,
                isSelected: false,
                item: session
            }))
            let {confirmed, payload: session} = await this.showPopup('SelectionPopup', {
                title: this.env._t('Please select: POS Session for assign this Order'),
                list: list,
            });
            if (confirmed) {
                var order = this.env.pos.get_order();
                order.pos_session_id = session.id;
                let order_ids = await this.env.pos.push_single_order(order, {
                    draft: true
                })
                await this.rpc({
                    model: 'pos.order',
                    method: 'write',
                    args: [order_ids, {
                        state: 'quotation',
                        is_quotation: true,
                        session_id: session.id,
                    }],
                }).then(function (result_write) {
                    return result_write
                }, function (err) {
                    return self.env.pos.query_backend_fail(err);
                })
                return this.showScreen('ReceiptScreen');
            }

        }
    }

    ButtonAssignOrder.template = 'ButtonAssignOrder';

    ProductScreen.addControlButton({
        component: ButtonAssignOrder,
        condition: function () {
            return this.env.pos.config.create_quotation;
        },
    });

    Registries.Component.add(ButtonAssignOrder);

    return ButtonAssignOrder;
});
