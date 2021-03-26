odoo.define('pos_retail.ProductsWidget', function (require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const ProductsWidget = require('point_of_sale.ProductsWidget');
    const {useState} = owl.hooks;
    const {useListener} = require('web.custom_hooks');
    const models = require('point_of_sale.models');
    const Registries = require('point_of_sale.Registries');

    const RetailProductsWidget = (ProductsWidget) =>
        class extends ProductsWidget {
            constructor() {
                super(...arguments);
            }

            mounted() {
                super.mounted();
            }

            willUnmount() {
                super.willUnmount();
            }


            willPatch() {
                super.willUnmount();
            }

            patched() {
                super.willUnmount();
            }
        }
    Registries.Component.extend(ProductsWidget, RetailProductsWidget);

    return RetailProductsWidget;
});
