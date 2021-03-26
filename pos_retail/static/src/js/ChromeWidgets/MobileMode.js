odoo.define('point_of_sale.MobileMode', function (require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const Registries = require('point_of_sale.Registries');

    class MobileMode extends PosComponent {
        constructor() {
            super(...arguments);
        }

        async onClick() {
            this.env.isMobile = !this.env.isMobile;
            this.env.qweb.forceUpdate();
        }
    }

    MobileMode.template = 'MobileMode';

    Registries.Component.add(MobileMode);

    return MobileMode;
});
