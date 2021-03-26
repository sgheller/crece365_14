odoo.define('point_of_sale.CustomerFacingScreenWiget', function (require) {
    'use strict';

    const {useState} = owl;
    const PosComponent = require('point_of_sale.PosComponent');
    const Registries = require('point_of_sale.Registries');

    class CustomerFacingScreenWiget extends PosComponent {
        constructor() {
            super(...arguments);
            this.onClick()
        }

        async onClick() {
            this.env.pos.customer_monitor_screen = window.open(window.location.origin + "/point_of_sale/display", 'winname', 'directories=no,titlebar=no,toolbar=no,location=no,status=no,menubar=no,width=' + this.env.pos.config.customer_facing_screen_width + ',height=' + this.env.pos.config.customer_facing_screen_height);
        }
    }

    CustomerFacingScreenWiget.template = 'CustomerFacingScreenWiget';

    Registries.Component.add(CustomerFacingScreenWiget);

    return CustomerFacingScreenWiget;
});
