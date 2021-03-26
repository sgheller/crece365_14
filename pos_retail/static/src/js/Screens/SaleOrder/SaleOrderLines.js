odoo.define('pos_retail.SaleOrderLines', function(require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const Registries = require('point_of_sale.Registries');

    class SaleOrderLines extends PosComponent {
        get highlight() {
            return this.props.order !== this.props.selectedOrder ? '' : 'highlight';
        }
        get SaleOrderLines() {
            const order = this.props.order
            const sale_lines = this.env.pos.db.lines_sale_by_id[order['id']];
            if (sale_lines && sale_lines.length > 0) {
                return sale_lines
            } else {
                return []
            }
        }
    }
    SaleOrderLines.template = 'SaleOrderLines';

    Registries.Component.add(SaleOrderLines);

    return SaleOrderLines;
});
