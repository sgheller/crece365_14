odoo.define('pos_retail.AccountInvoiceLines', function(require) {
    'use strict';

    const PosComponent = require('point_of_sale.PosComponent');
    const Registries = require('point_of_sale.Registries');

    class AccountMoveLines extends PosComponent {
        get highlight() {
            return this.props.move !== this.props.selectedMove ? '' : 'highlight';
        }
        get MoveLines() {
            const move = this.props.move
            const moveLines = this.env.pos.db.lines_invoice_by_id[move['id']];
            return moveLines
        }
    }
    AccountMoveLines.template = 'AccountMoveLines';

    Registries.Component.add(AccountMoveLines);

    return AccountMoveLines;
});
