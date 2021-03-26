odoo.define('pos_retail.ProductsWidget', function (require) {
    'use strict';

    const ProductsWidget = require('point_of_sale.ProductsWidget');
    const Registries = require('point_of_sale.Registries');
    const {posbus} = require('point_of_sale.utils');

    const RetailProductsWidget = (ProductsWidget) =>
        class extends ProductsWidget {
            constructor() {
                super(...arguments);
                this.search_extends = false;
                this.search_extends_results = []
            }

            mounted() {
                super.mounted();
                posbus.on('switch-product-view', this, this._trigger_search_extend);
            }

            willUnmount() {
                super.willUnmount();
                posbus.off('switch-product-view', this);
            }

            get hasNoCategories() {
                // kimanh: we force odoo for always return false, default odoo always hide if have not any categories
                return false
            }

            get searchExtendsActive() {
                return this.search_extends
            }

            get productsToDisplay() {
                let productsWillDisplay = super.productsToDisplay;
                if (this.env.pos.config.hidden_product_ids && this.env.pos.config.hidden_product_ids.length > 0) {
                    productsWillDisplay = productsWillDisplay.filter(p => !this.env.pos.config.hidden_product_ids.includes(p.id))
                }
                return productsWillDisplay
            }


            get productsToDisplayExtend() {
                if (this.search_extends_results && this.search_extends_results.length > 50) {
                    let newProducts = []
                    for (let i = 0; i < this.search_extends_results.length; i++) {
                        if (i >= 50) {
                            break
                        } else {
                            newProducts.push(this.search_extends_results[i])
                        }
                    }
                    return newProducts
                }
                return this.search_extends_results
            }

            _trigger_search_extend() {
                this.search_extends_results = this.env.pos.search_extends_results;
                if (!this.search_extends_results) {
                    this.search_extends = false
                } else {
                    this.search_extends = true
                }
                this.render()
            }

            remove_product_out_of_screen(product) {
                debugger
            }

            reload_products_screen(product_datas) {
                this.render();
            }

            _switchCategory(event) {
                console.log(event)
                this.search_extends = false
                super._switchCategory(event)
                if (event.detail == 0) {
                    this._clearSearch()
                    this.render()
                }
            }

            _clearSearch() {
                this.search_extends = null
                super._clearSearch()
            }

            get blockScreen() {
                const selectedOrder = this.env.pos.get_order();
                if (!selectedOrder || !selectedOrder.is_return) {
                    return false
                } else {
                    return true
                }
            }
        }
    Registries.Component.extend(ProductsWidget, RetailProductsWidget);

    return RetailProductsWidget;
});
