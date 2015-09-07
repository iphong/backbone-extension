void function(root, factory) {

	// Set up Backbone appropriately for the environment. Start with AMD.
	if (typeof define === 'function' && define.amd) {
		define(['underscore', 'backbone', 'exports'], function(_, Backbone, exports) {
			// Export global even in AMD case in case this script is loaded with
			// others that may still expect a global Backbone.
			root.B = factory(root, exports, _, Backbone);
		});

		// Next for Node.js or CommonJS.
	} else if (typeof exports !== 'undefined') {
		var _ = require('underscore');
		var Backbone = require('backbone');
		factory(root, exports, _, Backbone);

		// Finally, as a browser global.
	} else {
		root.B = factory(root, {}, root._, root.Backbone);
	}

}(this, function (root, B, _, Backbone) {

	var Model, Collection, Compute;

	/* --- Compute --- */
	Compute = B.Compute = function() {

		function Compute ( deps, options ) {
			if ( !(this instanceof Compute) )
				return new Compute(deps, options);
			if ( _.isArray(deps) && _.isFunction(options) )
				options = { deps: deps, get: options }
			else if ( _.isFunction(deps) )
				options = _.defaults({ get: deps }, options)
			else
				options = (deps || {});

			_.defaults(this, options, {
				deps: [],
				init: function () {
					return null;
				},
				get: function ( value ) {
					return value;
				},
				set: function ( value ) {
					return value;
				}
			})
		}

		return Compute
	}()

	/* --- Model --- */
	Model = B.Model = function () {

		function Model ( attrs, options ) {
			if ( !(this instanceof Model) )
				return Model.create.apply(null, arguments);
			_.extend(this, _.pick(options, '_parent', '_relatedKey'))
			_.each(this.computes, this._registerComputeValue, this)
			Backbone.Model.apply(this, arguments);
		}

		Model.prototype.__proto__ = Backbone.Model.prototype;

		// prototypes
		_.extend(Model.prototype, {

			relations: {},
			computes: {},

			get: function ( key ) {
				var value = this;
				var regex = /(\w+)(?:\[([0-9]+)\])?/g;
				var match;
				while ( match = regex.exec(key) ) {
					value = value instanceof Backbone.Model ? getComputedValue(value, match[ 1 ]) :
						typeof value == 'object' ? value[ match[ 1 ] ] : undefined;
					if ( match[ 2 ] )
						value = value instanceof Backbone.Collection ? value.at(match[ 2 ]) : value[ match[ 2 ] ];
				}
				return value;
			},

			//
			// Borrowed from "Backbone Nested Models" by "Bret Little"
			//
			setRelation: function ( attr, val, options ) {
				var relation = this.attributes[ attr ],
					id = this.idAttribute || "id",
					modelToSet, modelsToAdd = [], modelsToRemove = [];

				if ( options.unset && relation ) delete relation.parent;

				if ( this.relations && _.has(this.relations, attr) ) {

					// If the relation already exists, we don't want to replace it, rather
					// update the data within it whether it is a collection or model
					if ( relation && relation instanceof Collection ) {

						// If the val that is being set is already a collection, use the models
						// within the collection.
						if ( val instanceof Collection || val instanceof Array ) {
							val = val.models || val;
							modelsToAdd = _.clone(val);

							relation.each(function ( model, i ) {

								// If the model does not have an "id" skip logic to detect if it already
								// exists and simply add it to the collection
								if ( typeof model[ id ] == 'undefined' ) return;

								// If the incoming model also exists within the existing collection,
								// call set on that model. If it doesn't exist in the incoming array,
								// then add it to a list that will be removed.
								var rModel = _.find(val, function ( _model ) {
									return _model[ id ] === model[ id ];
								});

								if ( rModel ) {
									model.set(rModel.toJSON ? rModel.toJSON() : rModel);

									// Remove the model from the incoming list because all remaining models
									// will be added to the relation
									modelsToAdd.splice(i, 1);
								} else {
									modelsToRemove.push(model);
								}

							});

							_.each(modelsToRemove, function ( model ) {
								relation.remove(model);
							});

							relation.add(modelsToAdd);

						} else {

							// The incoming val that is being set is not an array or collection, then it represents
							// a single model.  Go through each of the models in the existing relation and remove
							// all models that aren't the same as this one (by id). If it is the same, call set on that
							// model.

							relation.each(function ( model ) {
								if ( val[ id ] === model[ id ] ) {
									model.set(val);
								} else {
									relation.remove(model);
								}
							});
						}

						return relation;
					}

					if ( val instanceof Model ) {
						val = val.toJSON()
					}

					if ( relation && relation instanceof Model ) {
						relation.set(val);
						return relation;
					}

					options._parent = this;
					options._relatedKey = attr;

					val = new this.relations[ attr ](val, options);
					val.parent = this;
				}

				return val;
			},
			set: function ( key, val, options ) {
				if ( typeof key == 'object' ) {
					options = val;
					return this._set(key, options)
				}
				if ( typeof key == 'string' ) {
					if ( !key.match(/[.\[]/) )
						return this._set(key, val, options)
					var regex = /(\w+)(?:\[([0-9]+)\])?/;
					var keys = key.split('.');
					var setAttr = keys.pop().match(regex);
					var getAttr = keys.join('.');
					if ( !setAttr[ 2 ] ) {
						var setter = this.get(getAttr);
						if ( setter instanceof Backbone.Model )
							setter.set(setAttr[ 1 ], val, options);
						else if ( typeof setter === 'object' )
							setter[ setAttr[ 1 ] ] = val;
						return this;
					}
					var collection = this.get(getAttr + '.' + setAttr[ 1 ]);
					if ( collection instanceof Backbone.Collection )
						collection.at(parseInt(setAttr[ 2 ])).set(val, options)
					else if ( typeof setter === 'object' )
						collection[ parseInt(setAttr[ 2 ]) ] = val;
					return this;
				}
			},
			_set: function ( key, val, options ) {
				var attr, attrs, unset, changes, silent, changing, prev, current;
				if ( key == null ) return this;

				// Handle both `"key", value` and `{key: value}` -style arguments.
				if ( typeof key === 'object' ) {
					attrs = key;
					options = val;
				} else {
					(attrs = {})[ key ] = val;
				}

				options || (options = {});

				// Run validation.
				if ( !this._validate(attrs, options) ) return false;

				// Extract attributes and options.
				unset = options.unset;
				silent = options.silent;
				changes = [];
				changing = this._changing;
				this._changing = true;

				if ( !changing ) {
					this._previousAttributes = _.clone(this.attributes);
					this.changed = {};
				}
				current = this.attributes, prev = this._previousAttributes;

				// Check for changes of `id`.
				if ( this.idAttribute in attrs ) this.id = attrs[ this.idAttribute ];

				// For each `set` attribute, update or delete the current value.
				for ( attr in attrs ) {
					if ( this.computes[ attr ] ) {
						val = getComputedValue(this, attr);
						this.computes[ attr ].set.call(this, val, options);
					}
					else {
						val = attrs[ attr ];
						// Inject in the relational lookup
						val = this.setRelation(attr, val, options);
					}

					if ( !_.isEqual(current[ attr ], val) ) changes.push(attr);
					if ( !_.isEqual(prev[ attr ], val) ) {
						this.changed[ attr ] = val;
					} else {
						delete this.changed[ attr ];
					}
					unset ? delete current[ attr ] : current[ attr ] = val;
				}

				// Trigger all relevant attribute changes.
				if ( !silent ) {
					if ( changes.length ) this._pending = true;
					for ( var i = 0, l = changes.length; i < l; i++ ) {
						this.trigger('change:' + changes[ i ], this, current[ changes[ i ] ], options);
					}
				}

				if ( changing ) return this;
				if ( !silent ) {
					while ( this._pending ) {
						this._pending = false;
						this.trigger('change', this, options);
						this._triggerParentChange(options);
					}
				}
				this._pending = false;
				this._changing = false;
				return this;
			},
			clone: function ( options ) {
				return new this.constructor(this.toJSON());
			},
			clear: function ( options ) {
				var attrs = {};
				for ( var key in this.attributes ) {
					if ( this.attributes[ key ] instanceof Backbone.Model )
						this.attributes[ key ].clear(options);
					else if ( this.attributes[ key ] instanceof Backbone.Collection )
						this.attributes[ key ].invoke('clear', options),
							this.attributes[ key ].reset([]);
					else
						attrs[ key ] = void 0;
				}
				return this.set(attrs, _.extend({}, options, { unset: true }));
			},
			toJSON: function ( options ) {
				var attrs = _.clone(this.attributes);
				attrs.__proto__ = null;

				_.each(this.relations, function ( rel, key ) {
					if ( _.has(attrs, key) ) {
						attrs[ key ] = attrs[ key ].toJSON();
					} else {
						attrs[ key ] = (new rel()).toJSON();
					}
				});

				return attrs;
			},
			toCompactJSON: function () {
				var attr, obj = Object.create(null, {});
				for ( var key in this.attributes ) {
					attr = this.attributes[ key ];
					if ( attr instanceof Model || attr instanceof Collection )
						attr = attr.toCompactJSON();
					if ( !_.isEqual(attr, this.defaults[ key ]) )
						obj[ key ] = attr;
				}
				return obj;
			},
			_triggerParentChange: function ( options ) {
				var parent = this._parent;
				if ( !parent ) return;

				parent.changed = {};
				_.extend(options, { chained: true })

				// Loop through every changed attribute
				for ( var key in this.changed ) {

					// Trigger "change:this.attr"
					parent.changed[ this._relatedKey + '.' + key ] = this.changed[ key ];
					parent.trigger('change:' + this._relatedKey + '.' + key, parent, this.changed[ key ], options);
				}
				//parent.changed[ this._relatedKey ] = this;
				parent.changed[ this._relatedKey ] = undefined;

				parent.trigger('change:' + this._relatedKey, parent, options);
				parent.trigger('change', parent, options);
				parent._triggerParentChange(options);
			},
			_registerComputeValue: function ( compute, attr ) {
				_.each(compute.deps, function ( dep ) {
					this.on('change:' + dep, function ( model, value, options ) {
						model.changed[ attr ] = model.get(attr);
						model.trigger('change:' + attr, model, model.changed[ attr ], options)
					})
				}, this)
			}
		})
		// statics
		_.extend(Model, {
			create: function ( attrs, protos, statics ) {
				var defaults = _.clone(attrs);
				var relations = {};
				var computes = {};
				for ( var attr in attrs ) {
					if ( isChildPrototypeOf(attrs[ attr ], Backbone.Model) ) {
						relations[ attr ] = attrs[ attr ];
						defaults[ attr ] = {};
					}
					else if ( isChildPrototypeOf(attrs[ attr ], Backbone.Collection) ) {
						relations[ attr ] = attrs[ attr ];
						defaults[ attr ] = [];
					}
					else if ( attrs[ attr ] instanceof Compute ) {
						computes[ attr ] = attrs[ attr ];
						delete defaults[ attr ];
					}
				}
				return Model.extend(_.extend({}, protos, {
					defaults: defaults,
					relations: relations,
					computes: computes
				}), statics);
			},
			extend: function () {
				return Backbone.Model.extend.apply(Model, arguments)
			}
		})

		return Model
	}();

	/* --- Collection --- */
	Collection = B.Collection = function() {

		function Collection ( models, options ) {
			if ( !(this instanceof Collection) )
				return Collection.create.apply(null, arguments);
			_.extend(this, _.pick(options, '_parent', '_relatedKey'))
			this.on('change', this._triggerParentChange)
			this.on('add', this._triggerParentChange)
			this.on('remove', this._triggerParentChange)
			Backbone.Collection.apply(this, arguments)
		}

		Collection.prototype.__proto__ = Backbone.Collection.prototype;

		// prototypes
		_.extend(Collection.prototype, {

			model: Model,

			_triggerParentChange: function( model, options ) {
				var parent = this._parent;
				if ( !parent ) return;

				// If this change event is triggered by one of its child model
				if ( model && model.collection ) {

					var modelIndex = model.collection.indexOf( model );

					parent.changed = {};
					_.extend(options, { chained: true })

					// Loop through every changed attributes of this model
					for ( var key in model.changed ) {

						// Trigger "change:collection[n].child"
						parent.changed[ this._relatedKey + '[' + modelIndex + '].' + key ] = model.changed[ key ];
						parent.trigger( 'change:' + this._relatedKey + '[' + modelIndex + '].' + key, parent, model.changed[ key ], options );

						// Trigger "change:collection.child"
						parent.changed[ this._relatedKey + '.' + key ] = model.changed[ key ];
						parent.trigger( 'change:' + this._relatedKey + '.' + key, parent, model.changed[ key ], options );
					}

					// Trigger "change:collection"
					//parent.changed[ this._relatedKey ] = this;
					parent.changed[ this._relatedKey ] = undefined;
					parent.trigger( 'change:' + this._relatedKey, parent, options );
					parent._triggerParentChange(options);
				}

				// Finally trigger "change"
				parent.trigger( 'change', parent, options );
			},
			resetRelations: function ( options ) {
				_.each(this.models, function ( model ) {
					_.each(model.relations, function ( rel, key ) {
						if ( model.get(key) instanceof Backbone.Collection ) {
							model.get(key).trigger('reset', model, options);
						}
					});
				})
			},
			reset: function ( models, options ) {
				options || (options = {});
				for ( var i = 0, l = this.models.length; i < l; i++ ) {
					this._removeReference(this.models[ i ]);
				}
				options.previousModels = this.models;
				this._reset();
				this.add(models, _.extend({ silent: true }, options));
				if ( !options.silent ) {
					this.trigger('reset', this, options);
					this.resetRelations(options);
				}
				return this;
			}
		})
		// statics
		_.extend(Collection, {
			create: function ( models, protos, statics ) {
				return Collection.extend(_.extend({}, protos, {
					model: _.isArray(models) ? models[ 0 ] : models
				}), statics)
			},
			extend: function () {
				return Backbone.Collection.extend.apply(Collection, arguments)
			}
		})

		return Collection
	}()

	/* --- Utils --- */
	function getComputedValue ( model, key ) {
		if (model.computes && model.computes[ key ]) {
			var compute = model.computes[ key ];
			var deps = _(compute.deps).map(function( dep ) {
				return getComputedValue(model,dep);
			})
			return compute.get.apply(model,deps);
		}
		return model.attributes[ key ];
	}
	function isChildPrototypeOf ( child, parent ) {
		if ( !child || !parent )
			return false;
		var result = false;
		var proto = child.prototype;
		while ( proto ) {
			if ( proto == parent.prototype ) {
				result = true;
				break;
			}
			proto = proto.__proto__;
		}
		return result;
	}

	return B
});
