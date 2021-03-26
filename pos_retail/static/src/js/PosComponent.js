odoo.define('pos_retail.RetailPosComponent', function (require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const {useState} = owl.hooks;
    const {useListener} = require('web.custom_hooks');
    const models = require('point_of_sale.models');
    const Registries = require('point_of_sale.Registries');
    const {Printer} = require('point_of_sale.Printer');
    const {posbus} = require('point_of_sale.utils');

    Registries.Component.add(PosComponent);

    const RetailPosComponent = (PosComponent) =>
        class extends PosComponent {
            showScreen(name, props) {
                super.showScreen(name, props)
            }

        }
    Registries.Component.extend(PosComponent, RetailPosComponent);

    return RetailPosComponent;
});
