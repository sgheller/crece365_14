odoo.define('pos_restaurant.SubmitProductsMainCourse', function (require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const ProductScreen = require('point_of_sale.ProductScreen');
    const {useListener} = require('web.custom_hooks');
    const Registries = require('point_of_sale.Registries');
    const core = require('web.core');
    const QWeb = core.qweb;

    /**
     * IMPROVEMENT: Perhaps this class is quite complicated for its worth.
     * This is because it needs to listen to changes to the current order.
     * Also, the current order changes when the selectedOrder in pos is changed.
     * After setting new current order, we update the listeners.
     */
    class SubmitProductsMainCourse extends PosComponent {
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

        showReceipt() {
            var printers = this.env.pos.printers;
            const selectedOrder = this.env.pos.get_order()
            for (var i = 0; i < printers.length; i++) {
                var changes = selectedOrder.computeChanges(printers[i].config.product_categories_ids);
                if (changes['new'].length > 0 || changes['cancelled'].length > 0) {
                    let receipt_html = QWeb.render('OrderChangeReceipt', {changes: changes, widget: selectedOrder});
                    let report_xml = QWeb.render('KitchenReceiptXml', {changes: changes, widget: selectedOrder});
                    this.showScreen('ReportScreen', {
                        report_html: receipt_html,
                        report_xml: report_xml,
                    });
                }
            }
            return true;
        }

        async onClick() {
            const changes = this._currentOrder.hasChangesToPrint();
            const skipped = changes ? false : this._currentOrder.hasSkippedChanges();
            if (!skipped) {
                return this.showPopup('ErrorPopup', {
                    title: this.env._t('Error'),
                    body: this.env._t('Have not any line is Main Course need send to Kitchen Printer')
                });
            }
            let {confirmed, payload: confirm} = await this.showPopup('ConfirmPopup', {
                title: this.env._t('Alert'),
                body: this.env._t('Are you want submit products Main Course to Kitchen Printer ?')
            })
            if (confirmed) {
                this._currentOrder.orderlines.models.forEach(l => {
                    if (l.mp_dbclk_time != 0 && l.mp_skip) {
                        this.mp_dbclk_time = 0
                        l.set_skip(false)
                    }
                })
                if (this._currentOrder.hasChangesToPrint()) {
                    const isPrintSuccessful = await this._currentOrder.printChanges();
                    this.showReceipt()
                    if (isPrintSuccessful) {
                        this._currentOrder.saveChanges();
                    } else {
                        await this.showPopup('ErrorPopup', {
                            title: 'Printing failed',
                            body: 'Failed in printing the changes in the order',
                        });
                    }
                }
            }
        }

        get addedClasses() {
            if (!this._currentOrder) return {};
            const changes = this._currentOrder.hasChangesToPrint();
            const skipped = changes ? false : this._currentOrder.hasSkippedChanges();
            return {
                highlight: skipped,
                altlight: changes,
            };
        }

        _updateCurrentOrder(pos, newSelectedOrder) {
            this._currentOrder.orderlines.off('change', null, this);
            if (newSelectedOrder) {
                this._currentOrder = newSelectedOrder;
                this._currentOrder.orderlines.on('change', this.render, this);
            }
        }
    }

    SubmitProductsMainCourse.template = 'SubmitProductsMainCourse';

    ProductScreen.addControlButton({
        component: SubmitProductsMainCourse,
        condition: function () {
            return this.env.pos.printers.length;
        },
    });

    Registries.Component.add(SubmitProductsMainCourse);

    return SubmitProductsMainCourse;
});
