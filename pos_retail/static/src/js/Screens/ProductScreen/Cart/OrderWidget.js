odoo.define('pos_retail.OrderWidget', function (require) {
        'use strict';

        const OrderWidget = require('point_of_sale.OrderWidget');
        const Registries = require('point_of_sale.Registries');


        const RetailOrderWidget = (OrderWidget) =>
            class extends OrderWidget {
                constructor() {
                    super(...arguments);
                }

                _selectLine(event) {
                    super._selectLine(event)
                }

                async _editPackLotLines(event) {
                    let self = this;
                    const orderline = event.detail.orderline;
                    const isAllowOnlyOneLot = orderline.product.isAllowOnlyOneLot();
                    const packLotLinesToEdit = orderline.getPackLotLinesToEdit(isAllowOnlyOneLot);
                    if (packLotLinesToEdit.length == 1 && packLotLinesToEdit[0].text == "" && this.env.pos.config.fullfill_lots && ['serial', 'lot'].includes(orderline.product.tracking)) {
                        let packLotLinesToEdit = await this.rpc({
                            model: 'stock.production.lot',
                            method: 'search_read',
                            domain: [['product_id', '=', orderline.product.id]],
                            fields: ['name', 'id']
                        }, {
                            shadow: true,
                            timeout: 65000
                        }).then(function (lots) {
                            return lots
                        }, function (error) {
                            return self.env.pos.query_backend_fail(error)
                        })
                        let newPackLotLinesToEdit = packLotLinesToEdit.map((lot) => ({text: lot.name}));
                        const {confirmed, payload} = await this.showPopup('EditListPopup', {
                            title: this.env._t('Selection only 1 Lot/Serial Number(s). It a required'),
                            isSingleItem: isAllowOnlyOneLot,
                            array: newPackLotLinesToEdit,
                        });
                        if (confirmed) {
                            const modifiedPackLotLines = Object.fromEntries(
                                payload.newArray.filter(item => item.id).map(item => [item.id, item.text])
                            );
                            const newPackLotLines = payload.newArray
                                .filter(item => !item.id)
                                .map(item => ({lot_name: item.text}));
                            if (newPackLotLines.length == 1) {
                                orderline.setPackLotLines({modifiedPackLotLines, newPackLotLines});
                            } else {
                                return this.showPopup('ErrorPopup', {
                                    title: this.env._t('Warning'),
                                    body: this.env._t('Please select only one Lot/Serial')
                                })
                            }
                        }
                        this.order.select_orderline(event.detail.orderline);
                    } else {
                        await super._editPackLotLines(event)
                    }
                }


                autoSetPromotion() {
                    if (this.order && !this.order.promotionRunning && this.order.get_promotions_active()['promotions_active'].length && this.env.pos.config.promotion_auto_add) {
                        this.order.apply_promotion()
                    }
                }

                autoRunCouponProgram() {
                    if (!this.env.pos.runningCouponProgram && this.order && this.order.get_total_with_tax() > 0 && !this.order.is_return) {
                        this.env.pos.automaticSetCoupon()
                    }
                }

                _updateSummary() {
                    if (this.order && this.order.get_client() && this.env.pos.loyalty) {
                        let points = this.order.get_client_point();
                        let plus_point = points['plus_point'];
                        this.order.plus_point = plus_point;
                        this.order.redeem_point = points['redeem_point'];
                        this.order.remaining_point = points['remaining_point'];
                    }
                    super._updateSummary();
                    const total = this.order ? this.order.get_total_with_tax() : 0;
                    if (total <= 0) {
                        this.state.tax = this.env.pos.format_currency(0);
                        this.render()
                    }
                    // this.env.pos.trigger('product.updated');
                    this.autoSetPromotion()
                    this.autoRunCouponProgram()
                    this.env.pos.trigger('update:customer-facing-screen');
                }
            }

        Registries.Component.extend(OrderWidget, RetailOrderWidget);

        return RetailOrderWidget;
    }
);
