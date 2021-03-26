odoo.define('pos_retail.ButtonSetPromotions', function (require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const ProductScreen = require('point_of_sale.ProductScreen');
    const {useListener} = require('web.custom_hooks');
    const Registries = require('point_of_sale.Registries');

    class ButtonSetPromotions extends PosComponent {
        constructor() {
            super(...arguments);
            useListener('click', this.onClick);
            this._currentOrder = this.env.pos.get_order();
            this._currentOrder.orderlines.on('change', this.render, this);
            this.env.pos.on('change:selectedOrder', this._updateCurrentOrder, this);
        }

        willUnmount() {
            this._currentOrder.orderlines.off('change', null, this);
            this.env.pos.off('change:selectedOrder', null, this);
        }

        _updateCurrentOrder(pos, newSelectedOrder) {
            this._currentOrder.orderlines.off('change', null, this);
            if (newSelectedOrder) {
                this._currentOrder = newSelectedOrder;
                this._currentOrder.orderlines.on('change', this.render, this);
            }
        }

        async onClick() {
            var order = this.env.pos.get_order();
            if (order.is_return) {
                return false;
            }
            order.remove_all_promotion_line();
            let promotions = order.get_promotions_active()['promotions_active'];
            if (promotions) {
                let {confirmed, payload: result} = await this.showPopup('ConfirmPopup', {
                    title: this.env._t('Alert, Promotions added before removed !!!'),
                    body: this.env._t('Are you want add back Promotions to this Order ?'),
                    cancelText: this.env._t('Remove Promotions added'),
                    cancelIcon: 'fa fa-trash',
                    confirmIcon: 'fa fa-check',
                })
                if (confirmed) {
                    order.apply_promotion()
                    this.showPopup('ConfirmPopup', {
                        title: this.env._t('Great !!!'),
                        body: this.env._t('Promotions Applied'),
                        disableCancelButton: true,
                    })
                } else {
                    order.remove_all_promotion_line();
                    this.showPopup('ConfirmPopup', {
                        title: this.env._t('Great !!!'),
                        body: this.env._t('Promotions Removed'),
                        disableCancelButton: true,
                    })
                }
            } else {
                this.showPopup('ErrorPopup', {
                    title: this.env._t('Warning'),
                    body: this.env._t('Have not any Promotions active')
                })
            }
        }

        get isHighlighted() {
            var order = this.env.pos.get_order();
            if (order.is_return) {
                return false;
            }
            let promotions = order.get_promotions_active()['promotions_active'];
            if (promotions.length) {
                return true
            } else {
                return false
            }
        }
    }

    ButtonSetPromotions.template = 'ButtonSetPromotions';

    ProductScreen.addControlButton({
        component: ButtonSetPromotions,
        condition: function () {
            return this.env.pos.config.promotion_ids.length && this.env.pos.config.promotion_manual_select;
        },
    });

    Registries.Component.add(ButtonSetPromotions);

    return ButtonSetPromotions;
});
