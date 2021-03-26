odoo.define('pos_retail.PosOrderRow', function (require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const Registries = require('point_of_sale.Registries');

    class PosOrderRow extends PosComponent {
        constructor() {
            super(...arguments);
            if (this.env.pos.config.big_datas_sync_realtime) {
                this._autoSyncBackend()
            }
        }

        async _autoSyncBackend() {
                let order_object = this.env.pos.get_model('pos.order');
                let syncResponse = await this.rpc({
                    model: 'pos.order',
                    method: 'search_read',
                    fields: order_object.fields,
                    args: [[['id', '=', this.props.order.id], ['write_date', '!=', this.props.order.write_date]]]
                }, {
                    shadow: true,
                    timeout: 7500
                })
                if (syncResponse.length == 1) {
                    console.log('[_autoSyncBackend] order id: ' + syncResponse[0].id)
                    this.env.pos.sync_with_backend('pos.order', syncResponse, false)
                }
            }

        get highlight() {
            return this.props.order !== this.props.selectedOrder ? '' : 'highlight';
        }

        showMore() {
            const order = this.props.order;
            const link = window.location.origin + "/web#id=" + order.id + "&view_type=form&model=pos.order";
            window.open(link, '_blank')
        }
    }

    PosOrderRow.template = 'PosOrderRow';

    Registries.Component.add(PosOrderRow);

    return PosOrderRow;
});
