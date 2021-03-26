odoo.define('pos_retail.PosOrderLines', function (require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const Registries = require('point_of_sale.Registries');

    class PosOrderLines extends PosComponent {
        constructor() {
            super(...arguments);
            if (this.env.pos.config.big_datas_sync_realtime) {
                this._autoSyncBackend()
            }
        }

        async _autoSyncBackend() {
            let pos_order_line_object = this.env.pos.get_model('pos.order.line');
            const lines = this.env.pos.db.lines_by_order_id[this.props.order['id']];
            const line_ids = _.pluck(lines, 'id')
            let syncResponse = await this.rpc({
                model: 'pos.order.line',
                method: 'search_read',
                fields: pos_order_line_object.fields,
                args: [[['id', 'in', line_ids]]]
            }, {
                shadow: true,
                timeout: 7500
            })
            if (syncResponse.length) {
                console.log('[_autoSyncBackend] order lines ids: ' + line_ids)
                this.env.pos.sync_with_backend('pos.order.line', syncResponse, false)
            }
        }

        get highlight() {
            return this.props.order !== this.props.selectedOrder ? '' : 'highlight';
        }

        get OrderLines() {
            var order = this.props.order
            var lines = this.env.pos.db.lines_by_order_id[order['id']];
            if (lines && lines.length) {
                return lines
            } else {
                return []
            }
        }
    }

    PosOrderLines.template = 'PosOrderLines';

    Registries.Component.add(PosOrderLines);

    return PosOrderLines;
});
