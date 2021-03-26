# -*- coding: utf-8 -*-

from odoo import models, fields

class PosPaymentMethod(models.Model):
    _inherit = "pos.payment.method"

    apply_charges = fields.Boolean("Apply Charges")
    fees_amount = fields.Float("Fees Amount")
    fees_type = fields.Selection(
        selection=[('fixed', 'Fixed'), ('percentage', 'Percentage')],
        string="Fees type",
        default="fixed")
    optional = fields.Boolean("Optional")
    shortcut_key = fields.Char('Shortcut Key')
    jr_use_for = fields.Boolean("Allow For Gift Card", default=False)

# vim:expandtab:smartindent:tabstop=4:softtabstop=4:shiftwidth=4:
