odoo.define('pos_retail.ProductItem', function (require) {
    'use strict';

    const ProductItem = require('point_of_sale.ProductItem');
    const Registries = require('point_of_sale.Registries');
    const {useListener} = require('web.custom_hooks');
    ProductItem.template = 'RetailProductItem';
    Registries.Component.add(ProductItem);
    const core = require('web.core');
    const qweb = core.qweb;

    const RetailProductItem = (ProductItem) =>
        class extends ProductItem {
            constructor() {
                super(...arguments);
                if (this.env.pos.config.big_datas_sync_realtime) {
                    this._autoSyncBackend()
                }
            }

            async _autoSyncBackend() {
                let product_object = this.env.pos.get_model('product.product');
                let syncResponse = await this.rpc({
                    model: 'product.product',
                    method: 'search_read',
                    fields: product_object.fields,
                    args: [[['id', '=', this.props.product.id], ['write_date', '!=', this.props.product.write_date]]]
                }, {
                    shadow: true,
                    timeout: 7500
                })
                if (syncResponse.length == 1) {
                    console.log('[_autoSyncBackend] product id: ' + syncResponse[0].id)
                    this.env.pos.sync_with_backend('product.product', syncResponse, false)
                }
            }

            mounted() {
                this.env.pos.on('product.updated', () => this.reloadProductItem(), this);
            }

            willUnmount() {
                this.env.pos.off('product.updated', null, this);
            }

            reloadProductItem() {
                if (this.env.pos.db.stock_datas && this.props.product.qty_available != this.env.pos.db.stock_datas[this.props.product.id]) {
                    this.props.product.qty_available = this.env.pos.db.stock_datas[this.props.product.id]
                    this.render();
                }
            }

            _onMouseEnter(event) {
                if (this.env.pos.config.product_view != 'box') {
                    return true
                }
                const product = this.props.product;
                let last_price;
                let last_order_name;
                let lines_need_check = [];
                let last_bought_date;
                let selectedOrder = this.env.pos.get_order();
                if (selectedOrder && selectedOrder.get_client()) {
                    const client = selectedOrder.get_client();
                    const orders = this.env.pos.db.get_pos_orders().filter(o => o.partner_id && o.partner_id[0] == client.id)
                    if (orders) {
                        for (let i = 0; i < orders.length; i++) {
                            let order = orders[i];
                            var old_lines = this.env.pos.db.lines_by_order_id[order['id']];
                            if (!old_lines) {
                                continue
                            }
                            for (let j = 0; j < old_lines.length; j++) {
                                var line = old_lines[j];
                                if (line.product_id && line.product_id[0] == product['id']) {
                                    lines_need_check.push(line)
                                }
                            }
                        }
                    }
                }
                if (lines_need_check.length) {
                    for (let j = 0; j < lines_need_check.length; j++) {
                        var line = lines_need_check[j];
                        if (!last_bought_date) {
                            last_bought_date = line.write_date;
                            last_price = line.price_unit;
                            last_order_name = line.order_id[1];
                            continue;
                        }
                        if (last_bought_date != line.write_date && new Date(last_price).getTime() < new Date(line.write_date).getTime()) {
                            last_bought_date = line.write_date;
                            last_price = line.price_unit;
                            last_order_name = line.order_id[1];
                        }
                    }
                }
                product.last_bought_date = this.env.pos.format_date(last_bought_date);
                product.last_price = last_price;
                product.last_order_name = last_order_name;
                this.props.product.isShowDetail = true;
                this.render()
                // if (!this.env.isMobile) {
                //     event.currentTarget.style.border = '1px solid #6EC89B'
                // }
            }

            _onMouseLeave(event) {
                this.props.product.isShowDetail = false;
                this.render()
                // if (!this.env.isMobile && this.env.pos.config.product_view == 'box') {
                //     event.currentTarget.style.border = 'none'
                // }
            }

            get disableSale() {
                const productSave = this.env.pos.db.get_product_by_id(this.props.product.id)
                if (!this.props.product.sale_ok || (this.env.pos.config.hide_product_when_outof_stock && !this.env.pos.config.allow_order_out_of_stock && this.props.product.type == 'product' && this.env.pos.db.stock_datas[this.props.product.id] <= 0) || !productSave || !productSave.available_in_pos) {
                    return true
                } else {
                    return false
                }
            }

            get price() {
                let price = 0;
                if (this.env.pos.config.display_sale_price_within_tax) {
                    price = this.props.product.get_price_with_tax(this.pricelist, 1)
                } else {
                    price = this.props.product.get_price(this.pricelist, 1)
                }
                const formattedUnitPrice = this.env.pos.format_currency(
                    price,
                    'Product Price'
                );
                if (this.props.product.to_weight) {
                    return `${formattedUnitPrice}/${
                        this.env.pos.units_by_id[this.props.product.uom_id[0]].name
                    }`;
                } else {
                    return formattedUnitPrice;
                }
            }

            get itemInCart() {
                let product = this.props.product;
                let selectedOrder = this.env.pos.get_order();
                let totalItems = 0
                if (selectedOrder) {
                    let orderLines = _.filter(selectedOrder.orderlines.models, function (o) {
                        return o.product.id == product.id
                    })
                    orderLines.forEach(function (l) {
                        totalItems += l.quantity
                    })
                }
                return totalItems
            }

            async editProduct() {
                await this.env.pos.sync_products_partners();
                let {confirmed, payload: results} = await this.showPopup('PopUpCreateProduct', {
                    title: this.env._t('Edit ') + this.props.product.display_name,
                    product: this.props.product
                })
                if (confirmed && results) {
                    let value = {
                        name: results.name,
                        list_price: parseFloat(results.list_price),
                        default_code: results.default_code,
                        barcode: results.barcode,
                        standard_price: parseFloat(results.standard_price),
                        type: results.type,
                        available_in_pos: true
                    }
                    if (results.pos_categ_id != 'null') {
                        value['pos_categ_id'] = parseInt(results['pos_categ_id'])
                    }
                    if (results.image_1920) {
                        value['image_1920'] = results.image_1920.split(',')[1];
                    }
                    await this.rpc({
                        model: 'product.product',
                        method: 'write',
                        args: [[this.props.product.id], value]
                    })
                    await this.env.pos.sync_products_partners();
                    this.render()
                }
            }

            async archiveProduct() {
                let {confirmed, payload: confirm} = await this.showPopup('ConfirmPopup', {
                    title: this.env._t('Alert'),
                    body: this.env._t('Archive Product : ') + this.props.product.display_name + this.env._t(' ?')
                })
                if (confirmed) {
                    await this.rpc({
                        model: 'product.product',
                        method: 'write',
                        args: [[this.props.product.id], {
                            available_in_pos: false,
                        }],
                        context: {}
                    })
                    await this.env.pos.sync_products_partners();
                    this.render()
                    this.env.pos.alert_message({
                        title: this.env._t('Archived Successfully !'),
                        body: this.props.product.display_name + ' has archived !'
                    })
                }
            }

            async addBarcode() {
                let newBarcode = await this.rpc({ // todo: template rpc
                    model: 'product.product',
                    method: 'add_barcode',
                    args: [[this.props.product.id]]
                })
                await this.env.pos.sync_products_partners();
                if (newBarcode) {
                    this.props.product['barcode'] = newBarcode
                    this.render()
                    this.printBarcode()
                }
            }

            async printBarcode() {
                await this.env.pos.do_action('product.report_product_product_barcode', {
                    additional_context: {
                        active_id: this.props.product.id,
                        active_ids: [this.props.product.id],
                    }
                }, {
                    shadow: true,
                    timeout: 6500
                });
                if (this.env.pos.config.proxy_ip && this.env.pos.config.iface_print_via_proxy) {
                    const reportXML = qweb.render('ProductBarcodeLabel', {
                        product: this.props.product
                    });
                    const printResult = await this.env.pos.proxy.printer.print_receipt(reportXML);
                    if (printResult.successful) {
                        this.showPopup('ConfirmPopup', {
                            title: this.env._t('Printed'),
                            body: this.props.product.display_name + this.env._t(' has printed. Check label at your printer'),
                            disableCancelButton: true,
                        })
                        return true;
                    }
                }
            }

            async doUpdateOnHand() {
                const product = this.props.product
                let stock_location_ids = this.env.pos.get_all_source_locations();
                let stock_datas = await this.env.pos._get_stock_on_hand_by_location_ids([product.id], stock_location_ids).then(function (datas) {
                    return datas
                });
                if (stock_datas) {
                    let items = [];
                    let withLot = false
                    if (product.tracking == 'lot') {
                        withLot = true
                    }
                    if (!withLot) {
                        for (let location_id in stock_datas) {
                            let location = this.env.pos.stock_location_by_id[location_id];
                            if (location) {
                                items.push({
                                    id: location.id,
                                    item: location,
                                    location_id: location.id,
                                    quantity: stock_datas[location_id][product.id]
                                })
                            }
                        }
                    } else {
                        let stockQuants = await this.rpc({
                            model: 'stock.quant',
                            method: 'search_read',
                            domain: [['product_id', '=', product.id], ['location_id', 'in', stock_location_ids]],
                            fields: [],
                            context: {
                                limit: 1
                            }
                        })
                        if (stockQuants) {
                            items = stockQuants.map((q) => ({
                                id: q.id,
                                item: q,
                                lot_id: q.lot_id[0],
                                lot_name: q.lot_id[1],
                                location_id: q.location_id[0],
                                location_name: q.location_id[1],
                                quantity: q.quantity
                            }));
                        }
                    }
                    if (items.length) {
                        let {confirmed, payload: result} = await this.showPopup('UpdateStockOnHand', {
                            title: this.env._t('Summary Stock on Hand (Available - Reserved) each Stock Location of [ ') + product.display_name + ' ]',
                            withLot: withLot,
                            array: items,
                        })
                        if (confirmed) {
                            const newStockArray = result.newArray

                            for (let i = 0; i < newStockArray.length; i++) {
                                let newStock = newStockArray[i];
                                if (!withLot) {
                                    await this.rpc({
                                        model: 'stock.location',
                                        method: 'pos_update_stock_on_hand_by_location_id',
                                        args: [newStock['location_id'], {
                                            product_id: product.id,
                                            product_tmpl_id: product.product_tmpl_id,
                                            quantity: parseFloat(newStock['quantity']),
                                            location_id: newStock['location_id']
                                        }],
                                        context: {}
                                    }, {
                                        shadow: true,
                                        timeout: 65000
                                    })
                                } else {
                                    await this.rpc({
                                        model: 'stock.quant',
                                        method: 'write',
                                        args: [newStock['id'], {
                                            quantity: parseFloat(newStock['quantity']),
                                        }],
                                        context: {}
                                    }, {
                                        shadow: true,
                                        timeout: 65000
                                    })
                                }
                            }
                            await this.env.pos._do_update_quantity_onhand([product.id]);
                            this.env.pos.alert_message({
                                title: product.display_name,
                                body: this.env._t('Successfully update stock on hand'),
                                color: 'success'
                            })
                            return this.doUpdateOnHand(product)
                        }
                    } else {
                        return this.showPopup('ErrorPopup', {
                            title: this.env._t('Warning'),
                            body: product.display_name + this.env._t(' not found stock on hand !!!')
                        })
                    }
                }
            }
        }
    Registries.Component.extend(ProductItem, RetailProductItem);

    return ProductItem;
});
