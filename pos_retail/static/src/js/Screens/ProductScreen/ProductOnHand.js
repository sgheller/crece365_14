odoo.define('pos_retail.ProductOnHand', function (require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const Registries = require('point_of_sale.Registries');
    const {useState, useExternalListener} = owl.hooks;
    const {posbus} = require('point_of_sale.utils');

    class ProductOnHand extends PosComponent {
        constructor() {
            super(...arguments);
            this.state = useState({
                refreshStock: false,
            });
            this.reloadStock()
        }

        async reloadStock() {
            if (this.env.pos.get_order()) {
                let currentStockLocation = this.env.pos.get_order().get_picking_source_location()
                let stock_datas = await this.env.pos._get_stock_on_hand_by_location_ids([this.props.product.id], [currentStockLocation['id']])
                for (let location_id in stock_datas) {
                    let location = this.env.pos.stock_location_by_id[location_id];
                    if (location) {
                        this.props.product.qty_available = stock_datas[location.id][this.props.product.id]
                        this.env.pos.db.stock_datas[this.props.product.id] = this.props.product.qty_available
                        this.render()
                    }
                }
            }

        }
    }

    ProductOnHand.template = 'ProductOnHand';

    Registries.Component.add(ProductOnHand);

    return ProductOnHand;
});
