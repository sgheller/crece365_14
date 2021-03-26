odoo.define('pos_retail.SearchBar', function (require) {
    'use strict';

    const SearchBar = require('point_of_sale.SearchBar');
    const Registries = require('point_of_sale.Registries');

    const RetailSearchBar = (SearchBar) =>
        class extends SearchBar {
            constructor() {
                super(...arguments);
            }

            clearInput() {
                this.state.searchInput = ""
                this.selectFilter("All Items")
                this.render();
            }

            onKeyup(event) {
                if (this.props.displayClearSearch && !['ArrowUp', 'ArrowDown', 'Enter'].includes(event.code)) { // only for products screen. When keyup event called here, trigger search input and filter products data from search box
                    this.trigger('clear-search-product-filter')
                    this.trigger('update-search', event.target.value);
                }
            }
        }
    Registries.Component.extend(SearchBar, RetailSearchBar);

    return RetailSearchBar;
});
