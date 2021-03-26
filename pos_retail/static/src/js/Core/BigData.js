odoo.define('pos_retail.big_data', function (require) {
    const models = require('point_of_sale.models');
    const session = require('web.session');
    const core = require('web.core');
    const _t = core._t;
    const db = require('point_of_sale.DB');
    const indexed_db = require('pos_retail.indexedDB');
    const field_utils = require('web.field_utils');
    const time = require('web.time');
    const retail_db = require('pos_retail.database');
    const bus = require('pos_retail.core_bus');
    const rpc = require('web.rpc');
    const exports = {};
    const {posbus} = require('point_of_sale.utils');

    const indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB || window.shimIndexedDB;

    if (!indexedDB) {
        window.alert("Your browser doesn't support a stable version of IndexedDB.")
    }


    // TODO testing case:
    // 1. create new product/partner backend >> passed
    // 2. update product/partner at backend > passed
    // 3. remove product in backend without product in cart >> passed
    // 4. remove product in backend within product in cart >> passed
    // 5. product operation still update in pos and backend change / remove
    // 6. remove partner in backend
    // 7. remove partner in backend but partner have set in order
    // 8. update partner in backend but partner mode edit on pos

    const _super_PosModel = models.PosModel.prototype;
    models.PosModel = models.PosModel.extend({
        initialize: function (session, attributes) {
            if (attributes && attributes.chrome) {
                this.chrome = attributes.chrome
            }
            let self = this;
            this.deleted = {};
            this.partner_model = null;
            this.product_model = null;
            this.total_products = 0;
            this.total_clients = 0;
            this.load_datas_cache = false;
            this.max_load = 9999;
            this.next_load = 10000;
            this.first_load = 10000;
            this.session = session.env.session;
            this.sequence = 0;
            this.model_lock = [];
            this.model_unlock = [];
            this.model_ids = this.session['model_ids'];
            this.start_time = this.session['start_time'];
            this.pos_retail = this.session['pos_retail'];
            this.company_currency_id = this.session['company_currency_id'];
            _super_PosModel.initialize.call(this, session, attributes);
            let fonts = _.find(this.models, function (model) { // TODO: odoo default need 5 seconds load fonts, we dont use font 'Lato','Inconsolata', it reason no need to wait
                return model.label == 'fonts'
            });
            fonts.loaded = function (self) {
                return true;
            };
            for (let i = 0; i < this.models.length; i++) {
                let this_model = this.models[i];
                if (this_model.model && this.model_ids[this_model.model]) {
                    this_model['max_id'] = this.model_ids[this_model.model]['max_id'];
                    this_model['min_id'] = this.model_ids[this_model.model]['min_id'];
                    if (this_model.model == 'product.product' && this_model.fields && this_model.fields.length) {
                        this.product_model = this_model;
                        this.model_lock.push(this_model);
                    }
                    if (this_model.model == 'res.partner' && this_model.fields) {
                        this.model_lock.push(this_model);
                        this.partner_model = this_model;
                    }
                } else {
                    this.model_unlock.push(this_model);
                }
            }
            // locked loyalty of odoo ee
            this.model_unlock.filter(model => model.model && model.model != 'loyalty.program')
            if (this.product_model && this.partner_model) {
                let models = {
                    'product.product': {
                        fields: this.product_model.fields,
                        domain: this.product_model.domain,
                        context: this.product_model.context,
                    },
                    'res.partner': {
                        fields: this.partner_model.fields,
                        domain: this.partner_model.domain,
                        context: this.partner_model.context,
                    }
                };
                for (let i = 0; i < this.model_unlock.length; i++) {
                    let model = this.model_unlock[i];
                    if (!model.model) {
                        continue
                    }
                    if (['sale.order', 'sale.order.line', 'pos.order', 'pos.order.line', 'account.move', 'account.move.line'].indexOf(model.model) != -1) {
                        models[model.model] = {
                            fields: model.fields,
                            domain: [],
                            context: {},
                        }
                    }
                }
                this.rpc({
                    model: 'pos.cache.database',
                    method: 'save_parameter_models_load',
                    args: [[], models]
                }, {
                    shadow: true,
                    timeout: 60000
                }).then(function (reinstall) {
                    console.log('Result of save_parameter_models_load: ' + reinstall);
                }, function (err) {
                    console.error(err);
                });
            }
            this.models = this.model_unlock;
            let pos_session_object = this.get_model('pos.session');
            if (pos_session_object) {
                pos_session_object.fields.push('required_reinstall_cache')
            }
            this.indexed_db = new indexed_db(this);
            // TODO: loaded cache of browse
            this.indexed_db.get_datas(this, 'cached', 1).then(function (results) {
                self.json_datas = {};
                if (results && results.length) {
                    for (let i = 0; i < results.length; i++) {
                        let result = results[i];
                        self.json_datas[result.id] = result.value
                    }
                }
            })
        },
        async reloadPosOrders() {
            this.set_synch('connecting', 'Syncing POS Orders');
            let orderOrder_models = _.filter(this.models, function (model) {
                return model.model == 'pos.order';
            });
            let OrderLine_models = _.filter(this.models, function (model) {
                return model.model == 'pos.order.line';
            });
            let posPayment_models = _.filter(this.models, function (model) {
                return model.model == 'pos.payment';
            });
            if (orderOrder_models.length > 0) {
                await this.load_server_data_by_model(orderOrder_models[0]);
            }
            if (OrderLine_models.length > 0) {
                await this.load_server_data_by_model(OrderLine_models[0]);
            }
            if (posPayment_models.length > 0) {
                await this.load_server_data_by_model(posPayment_models[0]);
            }
            this.set_synch('connected', 'POS Order Updated');
        },

        async reloadSaleOrder() {
            this.set_synch('connecting', 'Syncing Sale Orders');
            let saleOrder_models = _.filter(this.models, function (model) {
                return model.model == 'sale.order';
            });
            let saleOrderLine_models = _.filter(this.models, function (model) {
                return model.model == 'sale.order.line';
            });
            if (saleOrder_models.length > 0) {
                await this.load_server_data_by_model(saleOrder_models[0]);
            }
            if (saleOrderLine_models.length > 0) {
                await this.load_server_data_by_model(saleOrderLine_models[0]);
            }
            this.set_synch('connected', 'Sale Orders Updated');
        },

        async reloadAccountMove() {
            this.set_synch('connecting', 'Syncing Invoices');
            let accountMove_models = _.filter(this.models, function (model) {
                return model.model == 'account.move';
            });
            let accountMoveLine_models = _.filter(this.models, function (model) {
                return model.model == 'account.move.line';
            });
            if (accountMove_models.length > 0) {
                await this.load_server_data_by_model(accountMove_models[0]);
            }
            if (accountMoveLine_models.length > 0) {
                await this.load_server_data_by_model(accountMoveLine_models[0]);
            }
            this.set_synch('connected', 'Invoices Updated');
        },

        // TODO: sync backend
        update_products_in_cart: function (product_datas) {
            let orders = this.get('orders').models;
            for (let i = 0; i < orders.length; i++) {
                let order = orders[i];
                for (let j = 0; j < product_datas.length; j++) {
                    let product = product_datas[j];
                    let lines_the_same_product = _.filter(order.orderlines.models, function (line) {
                        return line.product.id == product.id
                    });
                    if (!lines_the_same_product) {
                        continue
                    } else {
                        for (let n = 0; n < lines_the_same_product.length; n++) {
                            let line_required_update = lines_the_same_product[n];
                            line_required_update.product = this.db.get_product_by_id(product['id']);
                            line_required_update.set_unit_price(product.lst_price);
                        }
                    }
                }
            }
        },
        remove_product_deleted_outof_orders: function (product_id) {
            let orders = this.get('orders').models;
            for (let n = 0; n < orders.length; n++) {
                let order = orders[n];
                for (let i = 0; i < order.orderlines.models.length; i++) {
                    let line = order.orderlines.models[i];
                    if (line.product.id == product_id) {
                        order.remove_orderline(line);
                    }
                }
            }
        },
        update_customer_in_cart: function (partner_datas) {
            this.the_first_load = true;
            let orders = this.get('orders').models;
            for (let i = 0; i < orders.length; i++) {
                let order = orders[i];
                let client_order = order.get_client();
                if (!client_order || order.finalized) {
                    continue
                }
                for (let n = 0; n < partner_datas.length; n++) {
                    let partner_data = partner_datas[n];
                    if (partner_data['id'] == client_order.id) {
                        let client = this.db.get_partner_by_id(client_order.id);
                        order.set_client(client);
                    }
                }
            }
            this.the_first_load = false;
        },
        remove_partner_deleted_outof_orders: function (partner_id) {
            let orders = this.get('orders').models;
            let order = orders.find(function (order) {
                let client = order.get_client();
                if (client && client['id'] == partner_id) {
                    return true;
                }
            });
            if (order) {
                order.set_client(null)
            }
            return order;
        },
        sync_with_backend: function (model, datas, dont_check_write_time) {
            this.set_synch('connecting', 'Syncing Model: ' + model);
            let self = this;
            if (datas.length == 0) {
                console.warn('Data sync is old times. Reject:' + model);
                return false;
            }
            this.db.set_last_write_date_by_model(model, datas);
            let model_sync = this.get_model(model);
            if (model == 'res.partner') {
                let partner_datas = _.filter(datas, function (partner) {
                    return !partner.deleted || partner.deleted != true
                });
                if (partner_datas.length) {
                    this.partner_model.loaded(this, partner_datas)
                    this.update_customer_in_cart(partner_datas);
                    for (let i = 0; i < partner_datas.length; i++) {
                        let partner_data = partner_datas[i];
                        this.db.partners_removed = _.filter(this.db.partners_removed, function (partner_id) {
                            return partner_data.id != partner_id
                        });
                    }
                    this.trigger('reload.clients_screen', partner_datas);
                }
            }
            if (model == 'product.product') {
                let product_datas = _.filter(datas, function (product) {
                    return !product.deleted || product.deleted != true
                });
                if (product_datas.length) {
                    this.product_model.loaded(this, product_datas)
                    posbus.trigger('switch-product-view')
                }
            }
            if (model == 'res.partner' || model == 'product.product') {
                let values_deleted = _.filter(datas, function (data) {
                    return data.deleted == true
                });
                let values_updated = _.filter(datas, function (data) {
                    return !data.deleted
                });
                if (values_updated.length) {
                    self.indexed_db.write(model, values_updated);
                }
                for (let i = 0; i < values_deleted.length; i++) {
                    let value_deleted = values_deleted[i];
                    self.indexed_db.unlink(model, value_deleted);
                    if (model == 'res.partner') {
                        this.remove_partner_deleted_outof_orders(value_deleted['id']);
                        this.db.partners_removed.push(value_deleted['id']);
                    }
                    if (model == 'product.product') {
                        const productSave = this.db.get_product_by_id(value_deleted['id'])
                        productSave['available_in_pos'] = false;
                        this.remove_product_deleted_outof_orders(value_deleted['id']);

                    }
                }
            }
            this.set_synch('connected', 'Successfully sync : ' + model);
        },
        // TODO : -------- end sync -------------
        query_backend_fail: function (error) {
            if (error && error.message && error.message.code && error.message.code == 200) {
                return this.chrome.showPopup('ErrorPopup', {
                    title: error.message.code,
                    body: error.message.data.message,
                })
            }
            if (error && error.message && error.message.code && error.message.code == -32098) {
                return this.chrome.showPopup('ErrorPopup', {
                    title: error.message.code,
                    body: this.env._t('Your Odoo Server Offline'),
                })
            } else {
                return this.chrome.showPopup('ErrorPopup', {
                    title: 'Error',
                    body: this.env._t('Odoo offline mode or backend codes have issues. Please contact your admin system'),
                })
            }
        },
        get_model: function (_name) {
            let _index = this.models.map(function (e) {
                return e.model;
            }).indexOf(_name);
            if (_index > -1) {
                return this.models[_index];
            }
            return false;
        },
        sort_by: function (field, reverse, primer) {
            let key = primer ?
                function (x) {
                    return primer(x[field])
                } :
                function (x) {
                    return x[field]
                };
            reverse = !reverse ? 1 : -1;
            return function (a, b) {
                return a = key(a), b = key(b), reverse * ((a > b) - (b > a));
            }
        },
        _get_active_pricelist: function () {
            let current_order = this.get_order();
            let default_pricelist = this.default_pricelist;
            if (current_order && current_order.pricelist) {
                let pricelist = _.find(this.pricelists, function (pricelist_check) {
                    return pricelist_check['id'] == current_order.pricelist['id']
                });
                return pricelist;
            } else {
                if (default_pricelist) {
                    let pricelist = _.find(this.pricelists, function (pricelist_check) {
                        return pricelist_check['id'] == default_pricelist['id']
                    });
                    return pricelist
                } else {
                    return null
                }
            }
        },
        get_process_time: function (min, max) {
            if (min > max) {
                return 1
            } else {
                return (min / max).toFixed(1)
            }
        },
        get_modifiers_backend: function (model) { // TODO: when pos session online, if pos session have notification from backend, we get datas modifires and sync to pos
            let self = this;
            return new Promise(function (resolve, reject) {
                if (self.db.write_date_by_model[model]) {
                    let args = [[], self.db.write_date_by_model[model], model, null];
                    if (model == 'pos.order' || model == 'pos.order.line') {
                        args = [[], self.db.write_date_by_model[model], model, self.config.id];
                    }
                    return this.query({
                        model: 'pos.cache.database',
                        method: 'get_modifiers_backend',
                        args: args
                    }).then(function (results) {
                        if (results.length) {
                            let model = results[0]['model'];
                            self.sync_with_backend(model, results);
                        }
                        self.set('sync_backend', {state: 'connected', pending: 0});
                        resolve()
                    }, function (error) {
                        self.query_backend_fail(error);
                        reject()
                    })
                } else {
                    resolve()
                }
            });
        },
        async sync_products_partners() {
            if (this.startingSync) {
                return true
            }
            this.startingSync = true
            const self = this;
            const model_values = this.db.write_date_by_model;
            let args = [];
            args = [[], model_values, this.config.id];
            let results = await this.rpc({
                model: 'pos.cache.database',
                method: 'sync_products_partners',
                args: args
            }, {
                shadow: true,
                timeout: 65000
            });
            let total = 0;
            for (let model in results) {
                let vals = results[model];
                if (vals && vals.length) {
                    self.sync_with_backend(model, vals);
                    total += vals.length;
                }
                if (vals.length > 0) {
                    console.log('[sync_products_partners] model: ' + model + '. Total updated: ' + vals.length)
                }
            }
            this.started_sync_products_partners = false
            this.trigger('update:total_notification_need_sync', 0);
            this.startingSync = false
            return total
        },
        save_results: function (model, results) {
            // TODO: When loaded all results from indexed DB, we restore back to POS Odoo
            if (model == 'product.product') {
                this.total_products += results.length;
                let process_time = this.get_process_time(this.total_products, this.model_ids[model]['count']) * 100;
                this.setLoadingMessage(_t('Products Installed : ' + process_time.toFixed(0) + ' %'), process_time / 100);
                console.log('[save_results] model: ' + model + ' total products: ' + this.total_products)
            }
            if (model == 'res.partner') {
                this.total_clients += results.length;
                let process_time = this.get_process_time(this.total_clients, this.model_ids[model]['count']) * 100;
                this.setLoadingMessage(_t('Partners Installed : ' + process_time.toFixed(0) + ' %'), process_time / 100);
                console.log('[save_results] model: ' + model + ' total clients: ' + this.total_clients)
            }
            let object = _.find(this.model_lock, function (object_loaded) {
                return object_loaded.model == model;
            });
            if (object) {
                object.loaded(this, results, {})
            } else {
                console.error('Could not find model: ' + model + ' for restoring datas');
                return false;
            }
            this.load_datas_cache = true;
            this.db.set_last_write_date_by_model(model, results);
        },
        api_install_datas: function (model_name) {
            let self = this;
            let installed = new Promise(function (resolve, reject) {
                function installing_data(model_name, min_id, max_id) {
                    self.setLoadingMessage(_t('Installing Model: ' + model_name + ' from ID: ' + min_id + ' to ID: ' + max_id));
                    let model = _.find(self.model_lock, function (model) {
                        return model.model == model_name;
                    });
                    let domain = [['id', '>=', min_id], ['id', '<', max_id]];
                    let context = {};
                    if (model['model'] == 'product.product') {
                        domain.push(['available_in_pos', '=', true]);
                        let price_id = null;
                        if (self.pricelist) {
                            price_id = self.pricelist.id;
                        }
                        let stock_location_id = null;
                        if (self.config.stock_location_id) {
                            stock_location_id = self.config.stock_location_id[0]
                        }
                        context['location'] = stock_location_id;
                        context['pricelist'] = price_id;
                        context['display_default_code'] = false;
                    }
                    if (min_id == 0) {
                        max_id = self.max_load;
                    }
                    self.rpc({
                        model: 'pos.cache.database',
                        method: 'install_data',
                        args: [null, model_name, min_id, max_id]
                    }).then(function (results) {
                        min_id += self.next_load;
                        if (typeof results == "string") {
                            results = JSON.parse(results);
                        }
                        if (results.length > 0) {
                            max_id += self.next_load;
                            installing_data(model_name, min_id, max_id);
                            self.indexed_db.write(model_name, results);
                            self.save_results(model_name, results);
                        } else {
                            if (max_id < model['max_id']) {
                                max_id += self.next_load;
                                installing_data(model_name, min_id, max_id);
                            } else {
                                resolve()
                            }
                        }
                    }, function (error) {
                        console.error(error.message.message);
                        let db = self.session.db;
                        for (let i = 0; i <= 100; i++) {
                            indexedDB.deleteDatabase(db + '_' + i);
                        }
                        reject(error)
                    })
                }

                installing_data(model_name, 0, self.first_load);
            });
            return installed;
        },
        remove_indexed_db: function () {
            let dbName = this.session.db;
            for (let i = 0; i <= 50; i++) {
                indexedDB.deleteDatabase(dbName + '_' + i);
            }
            console.log('remove_indexed_db succeed !')
        },
        load_server_data: function () {
            let self = this;
            return _super_PosModel.load_server_data.apply(this, arguments).then(function () {
                self.models = self.models.concat(self.model_lock);
                self.sync_products_partners()
                // TODO: stop sync here. when mounted Products Screen will auto sync. We dont want duplicate sync
            });
        },
    });
    db.include({
        init: function (options) {
            this._super(options);
            this.write_date_by_model = {};
            this.products_removed = [];
            this.partners_removed = [];
        },
        set_last_write_date_by_model: function (model, results) {
            /* TODO: this method overide method set_last_write_date_by_model of Databse.js
                We need to know last records updated (change by backend clients)
                And use field write_date compare datas of pos and datas of backend
                We are get best of write date and compare
             */
            this.product_max_id = 0
            for (let i = 0; i < results.length; i++) {
                let line = results[i];
                if (line.deleted) {
                    console.warn('[BigData.js] id: ' + line.id + ' of model ' + model + ' has deleted!')
                }
                if (!this.write_date_by_model[model]) {
                    this.write_date_by_model[model] = line.write_date;
                    this.product_max_id = line['id']
                    continue;
                }
                if (this.write_date_by_model[model] != line.write_date && new Date(this.write_date_by_model[model]).getTime() < new Date(line.write_date).getTime()) {
                    this.write_date_by_model[model] = line.write_date;
                    this.product_max_id = line['id']
                }
            }
            if (this.write_date_by_model[model] == undefined) {
                console.warn('[BigData.js] Datas of model ' + model + ' not found!')
            }
        },
        search_product_in_category: function (category_id, query) {
            let self = this;
            let results = this._super(category_id, query);
            results = _.filter(results, function (product) {
                return self.products_removed.indexOf(product['id']) == -1
            });
            return results;
        },
        get_product_by_category: function (category_id) {
            let self = this;
            let results = this._super(category_id);
            results = _.filter(results, function (product) {
                return self.products_removed.indexOf(product['id']) == -1
            });
            return results;
        },
        search_partner: function (query) {
            let self = this;
            let results = this._super(query);
            results = _.filter(results, function (partner) {
                return self.partners_removed.indexOf(partner['id']) == -1
            });
            return results;
        },
        get_partners_sorted: function (max_count) {
            // TODO: improved performace to big data partners , default odoo get 1000 rows, but we only allow default render 20 rows
            if (max_count && max_count >= 20) {
                max_count = 20;
            }
            let self = this;
            let results = this._super(max_count);
            results = _.filter(results, function (partner) {
                return self.partners_removed.indexOf(partner['id']) == -1
            });
            return results;
        },
    });

    models.load_models([
        {
            label: 'Reload Session',
            condition: function (self) {
                return self.pos_session.required_reinstall_cache;
            },
            loaded: function (self) {
                return new Promise(function (resolve, reject) {
                    self.rpc({
                        model: 'pos.session',
                        method: 'update_required_reinstall_cache',
                        args: [[self.pos_session.id]]
                    }, {
                        shadow: true,
                        timeout: 65000
                    }).then(function (state) {
                        self.remove_indexed_db();
                        self.reload_pos();
                        resolve(state);
                    }, function (err) {
                        self.remove_indexed_db();
                        self.reload_pos();
                        reject(err)
                    })
                });
            },
        },
    ], {
        after: 'pos.config'
    });

    models.load_models([
        {
            label: 'Stock Production Lot',
            model: 'stock.production.lot',
            fields: ['name', 'ref', 'product_id', 'product_uom_id', 'create_date', 'product_qty', 'barcode', 'replace_product_public_price', 'public_price', 'expiration_date'],
            lot: true,
            domain: function (self) {
                return []
            },
            loaded: function (self, lots) {
                lots = lots.filter(l => {
                    if (!l['expiration_date'] || (l['expiration_date'] >= time.date_to_str(new Date()) + " " + time.time_to_str(new Date()))) {
                        return true
                    } else {
                        return false
                    }
                })
                self.lots = lots;
                self.lot_by_name = {};
                self.lot_by_id = {};
                self.lot_by_product_id = {};
                for (let i = 0; i < self.lots.length; i++) {
                    let lot = self.lots[i];
                    self.lot_by_name[lot['name']] = lot;
                    self.lot_by_id[lot['id']] = lot;
                    if (!self.lot_by_product_id[lot.product_id[0]]) {
                        self.lot_by_product_id[lot.product_id[0]] = [lot];
                    } else {
                        self.lot_by_product_id[lot.product_id[0]].push(lot);
                    }
                }
            }
        },
        {
            label: 'Products',
            installed: true,
            loaded: function (self) {
                if (!self.indexed_db) {
                    self.indexed_db = new indexed_db(self);
                }
                return self.indexed_db.get_datas(self, 'product.product', self.session.model_ids['product.product']['max_id'] / 100000 + 1)
            }
        },
        {
            label: 'Installing Products',
            condition: function (self) {
                return self.total_products == 0;
            },
            loaded: function (self) {
                return self.api_install_datas('product.product')
            }
        },
        {
            label: 'Partners',
            installed: true,
            loaded: function (self) {
                return self.indexed_db.get_datas(self, 'res.partner', self.session.model_ids['res.partner']['max_id'] / 100000 + 1)
            }
        },
        {
            label: 'Installing Partners',
            condition: function (self) {
                return self.total_clients == 0;
            },
            loaded: function (self) {
                return self.api_install_datas('res.partner')
            }
        },
        {
            label: 'POS Orders',
            model: 'pos.order',
            condition: function (self) {
                return self.config.pos_orders_management;
            },
            context: function (self) {
                return {pos_config_id: self.config.id}
            },
            fields: [
                'create_date',
                'name',
                'date_order',
                'user_id',
                'amount_tax',
                'amount_total',
                'amount_paid',
                'amount_return',
                'pricelist_id',
                'partner_id',
                'sequence_number',
                'session_id',
                'state',
                'account_move',
                'picking_ids',
                'picking_type_id',
                'location_id',
                'note',
                'nb_print',
                'pos_reference',
                'payment_journal_id',
                'fiscal_position_id',
                'ean13',
                'expire_date',
                'is_return',
                'is_returned',
                'voucher_id',
                'email',
                'write_date',
                'config_id',
                'is_paid_full',
                'partial_payment',
                'session_id',
                'shipping_id',
            ],
            domain: function (self) {
                let domain = [];
                return domain
            },
            loaded: function (self, orders) {
                self.order_ids = [];
                for (let i = 0; i < orders.length; i++) {
                    let order = orders[i];
                    let create_date = field_utils.parse.datetime(order.create_date);
                    order.create_date = field_utils.format.datetime(create_date);
                    let date_order = field_utils.parse.datetime(order.date_order);
                    order.date_order = field_utils.format.datetime(date_order);
                    self.order_ids.push(order.id)
                }
                self.db.save_pos_orders(orders);
            }
        }, {
            label: 'POS Order Lines',
            model: 'pos.order.line',
            fields: [
                'name',
                'notice',
                'product_id',
                'price_unit',
                'qty',
                'price_subtotal',
                'price_subtotal_incl',
                'discount',
                'order_id',
                'plus_point',
                'redeem_point',
                'promotion',
                'promotion_reason',
                'is_return',
                'uom_id',
                'user_id',
                'note',
                'discount_reason',
                'create_uid',
                'write_date',
                'create_date',
                'config_id',
                'variant_ids',
                'returned_qty',
                'pack_lot_ids',
            ],
            domain: function (self) {
                return [['order_id', 'in', self.order_ids]]
            },
            condition: function (self) {
                return self.config.pos_orders_management;
            },
            loaded: function (self, order_lines) {
                if (!self.pos_order_line_ids) {
                    self.pos_order_line_ids = [];
                }
                for (let i = 0; i < order_lines.length; i++) {
                    let line = order_lines[i];
                    if (!self.pos_order_line_ids.includes(line.id)) {
                        self.pos_order_line_ids.push(line.id)
                    }
                }
                self.db.save_pos_order_line(order_lines);
            }
        }, {
            label: 'POS Payment',
            model: 'pos.payment',
            fields: [
                'pos_order_id',
                'amount',
                'payment_method_id',
                'name',
            ],
            domain: function (self) {
                return [['pos_order_id', 'in', self.order_ids]]
            },
            condition: function (self) {
                return self.config.pos_orders_management;
            },
            loaded: function (self, payments) {
                self.pos_payments_by_order_id = {}
                payments.forEach(p => {
                    if (!self.pos_payments_by_order_id[p.pos_order_id[0]]) {
                        self.pos_payments_by_order_id[p.pos_order_id[0]] = [p]
                    } else {
                        self.pos_payments_by_order_id[p.pos_order_id[0]].push(p)
                    }
                })
            }
        }, {
            label: 'POS Pack Operation Lot',
            model: 'pos.pack.operation.lot',
            fields: [
                'lot_name',
                'pos_order_line_id',
                'product_id',
                'lot_id',
                'quantity',
            ],
            domain: function (self) {
                return [['pos_order_line_id', 'in', self.pos_order_line_ids]]
            },
            condition: function (self) {
                return self.config.pos_orders_management;
            },
            loaded: function (self, pack_operation_lots) {
                self.pack_operation_lots = pack_operation_lots;
                self.pack_operation_lots_by_pos_order_line_id = {};
                for (let i = 0; i < pack_operation_lots.length; i++) {
                    let pack_operation_lot = pack_operation_lots[i];
                    if (!pack_operation_lot.pos_order_line_id) {
                        continue
                    }
                    if (!self.pack_operation_lots_by_pos_order_line_id[pack_operation_lot.pos_order_line_id[0]]) {
                        self.pack_operation_lots_by_pos_order_line_id[pack_operation_lot.pos_order_line_id[0]] = [pack_operation_lot]
                    } else {
                        self.pack_operation_lots_by_pos_order_line_id[pack_operation_lot.pos_order_line_id[0]].push(pack_operation_lot)
                    }
                }
            }
        }, {
            label: 'Sale Orders',
            model: 'sale.order',
            fields: [
                'create_date',
                'pos_config_id',
                'pos_location_id',
                'name',
                'origin',
                'client_order_ref',
                'state',
                'date_order',
                'validity_date',
                'user_id',
                'partner_id',
                'pricelist_id',
                'invoice_ids',
                'partner_shipping_id',
                'payment_term_id',
                'note',
                'amount_tax',
                'amount_total',
                'picking_ids',
                'delivery_address',
                'delivery_date',
                'delivery_phone',
                'book_order',
                'payment_partial_amount',
                'payment_partial_method_id',
                'write_date',
                'ean13',
                'pos_order_id',
                'write_date',
                'reserve_order',
                'reserve_from',
                'reserve_to',
                'reserve_table_id',
                'reserve_no_of_guests',
                'reserve_mobile'
            ],
            domain: function (self) {
                let domain = [];
                return domain
            },
            condition: function (self) {
                return self.config.booking_orders;
            },
            context: function (self) {
                return {pos_config_id: self.config.id}
            },
            loaded: function (self, orders) {
                if (!self.booking_ids) {
                    self.booking_ids = [];
                }
                for (let i = 0; i < orders.length; i++) {
                    let order = orders[i]
                    if (!self.booking_ids.includes(order.id)) {
                        self.booking_ids.push(order.id)
                    }
                    let create_date = field_utils.parse.datetime(order.create_date);
                    order.create_date = field_utils.format.datetime(create_date);
                    let date_order = field_utils.parse.datetime(order.date_order);
                    order.date_order = field_utils.format.datetime(date_order);
                    if (order.reserve_from) {
                        let reserve_from = field_utils.parse.datetime(order.reserve_from);
                        order.reserve_from = field_utils.format.datetime(reserve_from);
                    }
                    if (order.reserve_to) {
                        let reserve_to = field_utils.parse.datetime(order.reserve_to);
                        order.reserve_to = field_utils.format.datetime(reserve_to);
                    }
                }
                self.db.save_sale_orders(orders);
            }
        }, {
            model: 'sale.order.line',
            fields: [
                'name',
                'discount',
                'product_id',
                'order_id',
                'price_unit',
                'price_subtotal',
                'price_tax',
                'price_total',
                'product_uom',
                'product_uom_qty',
                'qty_delivered',
                'qty_invoiced',
                'tax_id',
                'variant_ids',
                'state',
                'write_date'
            ],
            domain: function (self) {
                return [['order_id', 'in', self.booking_ids]]
            },
            condition: function (self) {
                return self.config.booking_orders;
            },
            context: {'pos': true},
            loaded: function (self, order_lines) {
                if (!self.order_lines) {
                    self.order_lines = order_lines;
                } else {
                    self.order_lines = self.order_lines.concat(order_lines);
                    order_lines.forEach(l => {
                        self.order_lines = self.order_lines.filter(sol => sol.id != l.id)
                        self.order_lines.push(l)
                    })
                }
                self.db.save_sale_order_lines(order_lines);
            }
        },
        {
            model: 'account.move',
            condition: function (self) {
                return self.config.management_invoice;
            },
            fields: [
                'create_date',
                'name',
                'date',
                'ref',
                'state',
                'move_type',
                'auto_post',
                'journal_id',
                'partner_id',
                'amount_tax',
                'amount_total',
                'amount_untaxed',
                'amount_residual',
                'invoice_user_id',
                'payment_reference',
                'payment_state',
                'invoice_date',
                'invoice_date_due',
                'invoice_payment_term_id',
                'stock_move_id',
                'write_date',
                'currency_id',
            ],
            domain: function (self) {
                let domain = [['company_id', '=', self.company.id]];
                return domain
            },
            context: function (self) {
                return {pos_config_id: self.config.id}
            },
            loaded: function (self, invoices) {
                self.invoice_ids = []
                for (let i = 0; i < invoices.length; i++) {
                    self.invoice_ids.push(invoices[i]['id']);
                }
                self.db.save_invoices(invoices);
            },
            retail: true,
        },
        {
            model: 'account.move.line',
            condition: function (self) {
                return self.config.management_invoice;
            },
            fields: [
                'move_id',
                'move_name',
                'date',
                'ref',
                'journal_id',
                'account_id',
                'sequence',
                'name',
                'quantity',
                'price_unit',
                'discount',
                'debit',
                'credit',
                'balance',
                'price_subtotal',
                'price_total',
                'write_date'
            ],
            domain: function (self) {
                return [['move_id', 'in', self.invoice_ids]]
            },
            context: {'pos': true},
            loaded: function (self, invoice_lines) {
                self.db.save_invoice_lines(invoice_lines);
            },
            retail: true,
        },
    ]);

    let _super_Order = models.Order.prototype;
    models.Order = models.Order.extend({
        set_client: function (client) {
            if (!this.pos.the_first_load && client && client['id'] && this.pos.deleted['res.partner'] && this.pos.deleted['res.partner'].indexOf(client['id']) != -1) {
                client = null;
                return this.env.pos.chrome.showPopup('ErrorPopup', {
                    title: this.env._t('Warning'),
                    body: this.env._t('This client deleted from backend')
                })
            }
            _super_Order.set_client.apply(this, arguments);
        },
    });
});
