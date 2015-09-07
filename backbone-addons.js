void function( root, $, _, Backbone ) {

	var B = root.B = {};

	var Model, Collection, Computed, View, CollectionView, DataBinder;

	// Cached backbone prototypes and methods
	var BackboneModel = Backbone.Model;
	var BackboneCollection = Backbone.Collection;
	var BackboneView = Backbone.View;
	var BackboneModelGet = Backbone.Model.prototype.get;
	var BackboneModelSet = Backbone.Model.prototype.set;
	var BackboneCollectionSet = Backbone.Collection.prototype.set;
	var BackboneViewEnsureElement = BackboneView.prototype._ensureElement;

	// Use this element to store unused element of deleted views
	var $reusableElements = $( '<div>' );

	_.mixin( {
		isChildPrototypeOf: function( child, parent ) {
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
		},
		setPrototypeOf: function( child, proto ) {
			child.__proto__ = proto;
			return child;
		}
	} )


	/* --- Computed --- */
	Computed = B.Computed = function() {
		function Computed( deps, description ) {
			if ( this instanceof Computed == false )
				return new Computed( deps, description );
			if ( !_.isArray( deps ) )
				description = deps, deps = [];
			if ( _.isFunction( description ) )
				description = {
					deps: deps,
					get: description
				};
			if ( !description )
				throw "Computed value requires at least a get function.";
			_.extend( this, description );
			_.defaults( this, {
				deps: [],
				get: _.noop,
				set: _.noop
			} );
		}

		_.extend( Computed.prototype, Backbone.Events );
		return Computed;
	}();

	/* --- Model --- */
	Model = B.Model = function() {

		var attrRegex = /^([0-9a-zA-Z_$]+)(\[([0-9]+)?\])?$/;

		function Model( attrs, options, statics ) {

			if ( this instanceof Model === false ) {
				var defaults = {};
				var relations = {};
				attrs && _.each( attrs, function( value, key ) {
					if ( _( value ).isChildPrototypeOf( Model ) ) {
						defaults[ key ] = {};
						relations[ key ] = value;
					}
					else if ( _( value ).isChildPrototypeOf( Collection ) ) {
						defaults[ key ] = [];
						relations[ key ] = value;
					}
					else
						defaults[ key ] = value;
				} );
				return Model.extend( _.extend({}, {
					constructor: function _Model() {
						Model.apply(this,arguments);
					},
					defaults: defaults,
					relations: relations
				}, options, statics ));
			}

			var parent;
			var options = options || {};
			var attrs = attrs || {};
			var foundRelatedKey = false;

			for ( var key in attrs ) {
				if ( attrs[ key ] instanceof BackboneModel || attrs[ key ] instanceof BackboneCollection )
					attrs[ key ].parent = this;
			}
			Object.defineProperties( this, {
				'root': {
					get: function() {
						var root = this;
						var parent = this.collection || this.parent;
						while (parent) {
							root = parent;
							parent = parent.collection || parent.parent;
						}
						return root;
					}
				},
				'_relatedKey': {
					get: function() {
						if ( foundRelatedKey )
							return foundRelatedKey;
						if ( this.parent && this.parent.attributes )
							for ( var key in this.parent.attributes )
								if ( this.parent.attributes[ key ] === this )
									return foundRelatedKey = key;
					}
				}
			});

			this.on( 'change', function( model, options ) {
				// If this model is a nested model
				if ( !(parent = this.parent) )
					return;

				model.parent.changed = {};

				// Loop through every changed attribute
				for ( var key in model.changed ) {

					// Trigger "change:model.attr"
					model.parent.changed[ model._relatedKey + '.' + key ] = model.changed[ key ];
					model.parent.trigger( 'change:' + model._relatedKey + '.' + key, model.parent, model.changed[ key ], options );
				}
				model.parent.changed[ model._relatedKey ] = model;

				triggerParentChange(model,options);
			} );

			var triggerParentChange = _.debounce(function( model, options ) {
				model.parent.trigger( 'change:' + model._relatedKey, model.parent, options );
				model.parent.trigger( 'change', model.parent, options );
			});

			BackboneModel.call( this, attrs, options );

			_.setPrototypeOf( this.attributes, null );
		}
		_.extend( Model.prototype, {
			constructor: Model,
			get: function( key ) {

				if ( !key.match( /[.\[]/ ) ) {
					var value = this.attributes[ key ];

					if ( value instanceof Computed )
						value = value.get.call( this );

					return value;
				}

				var keys = key.split( '.' ),
					obj = this;

				while ( keys.length ) {
					var m = attrRegex.exec( keys.shift() );
					var k = m[ 1 ]; var a = m[ 2 ]; var i = m[ 3 ];

					if ( !k )
						throw 'Invalid object attribute key';
					if ( !obj )
						return undefined;

					obj = (obj instanceof Backbone.Model) ? obj.get( k ) : obj[ k ];

					if ( a )
						obj = (obj instanceof Backbone.Collection) ? obj.at( parseInt( i ) ) : obj[ parseInt( i ) ];
				}
				return obj;
			},
			// model.set('foo');
			// model.set('foo.bar');
			// model.set('foo[0]');
			// model.set('foo.bar[0]');
			// model.set('foo[0].bar');
			// model.set('foo[0].bar[0]');
			set: function( key, value, options ) {

				if ( _.isObject( key ) ) {
					options = value;
					return _.each( key, function( value, key ) {
							this.set( key, value, options );
						}, this ) && this;
				}
				if ( !key.match( /[.\[]/ ) ) {
					var conputedValue = this.get( key );

					if ( conputedValue instanceof Computed )
						return conputedValue.set.call( this, value, options );
					else
						return BackboneModelSet.call( this, key, value, options );
				}

				var keys = key.split( '.' ),
					obj = this;
				while ( obj && keys.length ) {
					var m = attrRegex.exec( keys.shift() );
					var k = m[ 1 ]; var a = m[ 2 ]; var i = m[ 3 ];

					if ( !k )
						throw 'Invalid object attribute key';

					if ( keys.length ) {
						obj = (obj instanceof Backbone.Model) ? obj.get( k ) : obj[ k ];
						if ( i )
							obj = (obj instanceof Backbone.Collection) ? obj.at( parseInt( i ) ) : obj[ parseInt( i ) ];
					}

					if ( !keys.length ) {
						if ( !a ) {
							if ( obj instanceof Backbone.Model )
								obj.set( k, value, options );
							else if ( obj instanceof Backbone.Collection )
								obj.set( k, value, options );
							else if ( obj instanceof Object )
								obj[ k ] = value;
						}
						else if ( i ) {
							obj = (obj instanceof Backbone.Model) ?
								obj.get( k ) : obj[ k ];

							obj instanceof Backbone.Collection ?
								obj.at( i ).set( value, options ) : (obj[ i ] = value);
						}
						else {
							console.warn( 'Can not set "' + key + '"', value )
						}
					}
				}
				return this;
			},
			clear: function( options ) {
				var attrs = {};
				for ( var key in this.attributes ) {
					if ( this.attributes[ key ] instanceof Backbone.Model )
						this.attributes[ key ].clear( options );
					else if ( this.attributes[ key ] instanceof Backbone.Collection )
						this.attributes[ key ].invoke( 'clear', options ),
							this.attributes[ key ].reset( [] );
					else
						attrs[ key ] = void 0;
				}
				return this.set( attrs, _.extend( {}, options, { unset: true } ) );
			},
			toCompactJSON: function() {
				var attr, obj = Object.create(null,{});
				for (var key in this.attributes) {
					attr = this.attributes[ key ];
					if (attr instanceof Model || attr instanceof Collection)
						attr = attr.toCompactJSON();
					if (!_.isEqual(attr, this.defaults[ key ]))
						obj[key] = attr;
				}
				return obj;
			}
		});
		_.setPrototypeOf( Model.prototype, BackboneModel.prototype );
		Model.extend = _.compose( BackboneModel.extend, function( options ) {
			var options = (options || {});
			var defaults = options.defaults;
			var relations = (options.relations || {})
			for (var key in defaults) {
				if (_(defaults[key] ).isChildPrototypeOf(BackboneModel)) {
					relations[key] = defaults[key];
					defaults[key] = {};
				}
				if (_(defaults[key] ).isChildPrototypeOf(BackboneCollection)) {
					relations[key] = defaults[key];
					defaults[key] = [];
				}
			}
			return options;
		} );
		return Model;
	}()

	/* --- Collection --- */
	Collection = B.Collection = function() {
		function Collection( models, options, statics ) {

			if ( this instanceof Collection === false )
				return Collection.extend( _.extend( {}, {
					constructor: function _Collection() {
						Collection.apply(this,arguments);
					},
					model: _.isArray(models) ? models[0] : models
				}, options, statics));

			var parent;
			var options = options || {};

			var foundRelatedKey = false;
			Object.defineProperty( this, '_relatedKey', {
				get: function() {
					if ( foundRelatedKey )
						return foundRelatedKey;
					if ( parent && parent.attributes )
						for ( var key in parent.attributes )
							if ( parent.attributes[ key ] === this )
								return foundRelatedKey = key;
				}
			} );

			// On collection change event
			this.on( 'change', function( model, options ) {

				// If this model is not a nested collection then ignore
				if ( !(parent = this.parent) )
					return;

				parent.changed = {};

				// If this change event is triggered by one of its child model
				if ( model && model.collection ) {

					var modelIndex = model.collection.indexOf( model );

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
					parent.changed[ this._relatedKey ] = this;
					parent.trigger( 'change:' + this._relatedKey, parent, options );
				}

				// Finally trigger "change"
				parent.trigger( 'change', parent, options );
			} )

			BackboneCollection.apply( this, arguments );
		}
		_.extend( Collection.prototype, {
			comparator: function( model ) {
				return model.get( 'index' );
			},
			toCompactJSON: function() {
				var models = _(this.models).map(function(model) {
					return model instanceof BackboneModel ? model.toCompactJSON() : model.toJSON();
				});
				models.__proto__ = null;
				return models;
			}
		})
		_.setPrototypeOf( Collection.prototype, BackboneCollection.prototype );
		Collection.extend = BackboneCollection.extend;
		return Collection;
	}()

	/* --- View --- */
	View = B.View = function () {
		function View( options ) {

			if ( !(this instanceof View) )
				return new View( options );

			var options = (options || {});

			this.__ready = _.once( this.__ready );
			this.subViews = [];

			_.extend( this, _.pick( options, 'template', 'views', 'bindings', 'events', 'modelEvents', 'superView' ) );

			if ( this.template )
				switch ( typeof this.template ) {
					case 'string':
						this.template = this.template.match( '<' ) ? this.template.trim() : $( this.template ).html();
						break;
				}

			Object.defineProperties( this, {
				'rootView': {
					get: function() {
						var root = this;
						var parent = this.superView;
						while (parent) {
							root = parent;
							parent = parent.superView;
						}
						return root;
					}
				}
			});

			BackboneView.call( this, options );
			this.el && this.el.parentNode && this.__ready();
		}
		_.extend( View.prototype , {
			bindings: false,
			initialize: _.noop,
			ready: _.noop,
			_ensureElement: function() {
				BackboneViewEnsureElement.call( this );
				this.render();
				// This function is called right before initialize
				// So when initialize is called, element HTML is ready to be bound to views
			},
			setModel: function( model ) {
				if ( !model )
					return;
				if ( this.modelEvents )
					_( this.modelEvents ).each( function( handler, bind ) {
						bind = _( [ 'event', 'selector' ] ).object( _( bind.match( /(.*)\s(.*)/ ) || [ 0, bind ] ).rest( 1 ) );
						handler = _.isString( handler ) ? this[ handler ] : handler;
						this.model && this.stopListening( bind.selector ? this.model.get( bind.selector ) : this.model, bind.event );
						this.listenTo( bind.selector ? model.get( bind.selector ) : model, bind.event, handler );
					}, this );
				this.model = model;
			},
			setBindingModel: function( model ) {
				!this.__dataBinding && console.warn( "Data-binding hasn't been initialized for this view." );
				this.__dataBinding && this.__dataBinding.setModel( model );
				return this;
			},
			__ready: function() {
				this.initSubViews();
				this.initDataBinding();
				this.setModel( this.model );
				this.ready();
			},
			freeze: function() {
				this._frozen = true;
				this.trigger( 'freeze' );
				return this;
			},
			unfreeze: function() {
				this._frozen = false;
				this.trigger( 'unfreeze' );
				return this;
			},
			preventDefault: function( e ) {
				e.preventDefault();
			},
			stopPropagation: function( e ) {
				e.stopPropagation();
			},
			defer: function( fn, context ) {
				_.defer( _.bind( fn, context || this ) );
				return this;
			},
			delay: function( fn, delay, context ) {
				_.delay( _.bind( fn, context || this ), delay );
				return this;
			},
			render: function() {
				return this.__render.apply( this, arguments );
			},
			__render: function() {
				this.trigger( 'before:render' );
				this.template && this.$el.html( this.template );
				this.trigger( 'render' );
				return this;
			},

			initDataBinding: function() {
				if (this.__dataBinding)
					return;
				this.__dataBinding = new DataBinder( this, this.model, { bindings: _.result( this, 'bindings' ) || [] } );
			},
			initSubViews: function() {
				var regex = (/^(\w+)(?: (collection|model):(\w+))?\s*>\s*(.*)$/);
				_.each( this.views, function( view, define ) {
					var match = define.match( regex );
					if ( !match )
						throw "View definition syntax error: '" + define + "'";
					var key = match[ 1 ];
					var type = match[ 2 ];
					var attr = match[ 3 ];
					var selector = match[ 4 ];
					var options = {};
					type && attr && (options[ type ] = this.model.get( attr ));
					this[ key ] = this.attachView( view, selector, options );
				}, this );
			},
			hasView: function( view ) {
				return this.subViews && this.subViews.indexOf( view ) > -1;
			},
			attachView: function( view, selector, options ) {
				var el = this.$( selector ).get( 0 );
				if ( !el )
					throw 'No element found for selector "' + selector + '"';
				if ( _.isFunction( view ) ) {
					options || (options = {});
					options.el = el;
					options.superView = this;
					view = new view( options );
				}
				else {
					view.setElement( el );
					view.superView = this;
					this.hasView( view ) || this.subViews.push( view );
				}
				view.__ready();
				return view;
			},
			appendView: function( view ) {
				this.hasView( view ) || this.subViews.push( view );
				view.superView = this;
				view.$el.appendTo( this.el );
				view.__ready();
				return view;
			},
			prependView: function( view ) {
				this.hasView( view ) || this.subViews.push( view );
				view.superView = this;
				view.$el.prependTo( this.el );
				view.__ready();
				return view;
			},
			remove: function() {
				this.trigger( 'before:remove' );
				BackboneView.prototype.remove.call( this );
				this.superView &&
				this.superView.subViews &&
				_( this.superView.subViews ).each( function( subView, index ) {
					if ( subView && subView.cid == this.cid )
						this.superView.subViews.splice( index, 1 );
				}, this );
				this.trigger( 'remove' );
				return this;
			}
		});
		_.setPrototypeOf( View.prototype, BackboneView.prototype );
		View.extend = BackboneView.extend;
		return View;
	}()

	/* --- CollectionView --- */
	CollectionView = B.CollectionView = function() {
		function CollectionView( options ) {

			if ( !(this instanceof CollectionView) )
				return new CollectionView( options );

			this.previousSubViews = {};
			this.options = options || {};
			this._debounceReset = _.debounce( this.reset );
			options.collection || (options.collection = new Backbone.Collection);
			View.call( this, options );
		}
		_.extend( CollectionView.prototype , {
			itemView: View,
			_reverseOrder: false,
			_ensureElement: function() {
				BackboneViewEnsureElement.call( this );
				this.__render();
				// This function is called right before initialize
				// So when initialize is called, element HTML is ready to be bound to views
				this.getItemTemplate();
			},
			__ready: function() {
				this.setCollection( this.collection );
				this.ready();
			},
			getItemTemplate: function() {
				var child = this.el.children[ 0 ];
				if ( child ) {
					var template = child.innerHTML.trim();
					if ( this.itemView.prototype == View.prototype )
						this.itemView = this.itemView.extend();
					_.extend( this.itemView.prototype, {
						template: template,
						tagName: child.tagName,
						className: child.className,
						attributes: _( child.attributes )
							.chain()
							.values()
							.map( function( attr ) {
								return attr.name;
							} )
							.object( [] )
							.mapObject( function( value, key ) {
								return child.getAttribute( key );
							} )
							.value()
					} );
				}
				this.$el.empty();
			},
			setCollection: function( collection ) {
				if ( !collection )
					return;
				if ( collection !== this.collection )
					this.collection = collection;
				this.stopListening( this.collection, 'add', this.add );
				this.stopListening( this.collection, 'reset', this._debounceReset );
				this.stopListening( this.collection, 'sort', this._debounceReset );
				this.listenTo( this.collection, 'add', this.add );
				this.listenTo( this.collection, 'reset', this._debounceReset );
				this.listenTo( this.collection, 'sort', this._debounceReset );
				this.reset();
			},
			add: function( model ) {
				if ( this.previousSubViews[ model.cid ] ) {
					var view = this.previousSubViews[ model.cid ];
					delete this.previousSubViews[ model.cid ];
				}
				else {
					var view = new this.itemView( { model: model } );
				}
				view.mid = model.cid;
				this._reverseOrder ?
					this.prependView( view ) :
					this.appendView( view );
				return view;
			},
			reset: function() {
				while ( this.subViews.length ) {
					var view = this.subViews.pop();
					this.previousSubViews[ view.mid ] = view;
				}
				this.collection.each( this.add, this );

				for ( var key in this.previousSubViews ) {
					this.previousSubViews[ key ].$el.appendTo( $reusableElements );
					//delete this.previousSubViews[key];
				}
				return this;
			}
		} )
		_.setPrototypeOf( CollectionView.prototype, View.prototype );
		CollectionView.extend = View.extend;
		return CollectionView;
	}()

	/* --- Data Binder --- */
	DataBinder = B.DataBind = function() {

		// Parse element data binding definition string
		var bindingRegex = (/(?:(\w+):)?({.*}|[^;]+);?/ig);

		parseb = function parseBindingString( string ) {
			var bindRegex = (/\s*(\w+)\s*:\s*([^,{]+(?!\()|\{(.+)\},(?=\s*\w)|\w+\(.+\)),?/g);
			var match, obj = Object.create( null, {} );
			var string = string
				.replace( /\s+/, ' ' )
				.replace( /(.*)\}$/, '$1},a' );
			while ( match = bindRegex.exec( string ) ) {
				var key = match[ 1 ],
					value = match[ 2 ],
					nestedValues = match[ 3 ];
				if ( nestedValues )
					value = parseBindingString( nestedValues );
				obj[ key ] = value;
			}
			return obj;
		};

		function DataBinder( view, models, options ) {

			if ( this instanceof DataBinder === false )
				return new DataBinder( view, models, options );

			options || (options = {});

			this.options = _( options ).defaults( {
				bindings: []
			} );

			this.view = null;
			this.models = [];
			this.bindings = [];

			_.bindAll( this,
				'inputEventHandler',
				'changeEventHandler',
				'modelChangeHandler'
			);

			this.setupView( view );
			this.setModel( models );

			return this;
		};

		_.setPrototypeOf( DataBinder.prototype, Backbone.Events );

		_.extend( DataBinder.prototype, {

			setModel: function( models ) {
				_( this.models ).each( function( model ) {
					this.stopListening( model );
				}, this );
				this.models = _.filter( _.isArray( models ) ? models : [ models ], function( model ) {
					return model instanceof Backbone.Model;
				} );
				_( this.models ).each( function( model ) {
					this.listenTo( model, 'change', this.modelChangeHandler );
				}, this );
				this.updateView();
				return this;
			},

			setupView: function( view ) {
				if ( view instanceof Backbone.View == false )
					return false;

				_( this.bindings ).each( function( binding ) {
					binding.$el.off( binding.events || 'change', this.changeEventHandler );
				}, this );

				var self = this;
				var binding, $children;

				this.view = view;
				this.bindings = [];
				this.bindingsIndex = {};

				_( this.options.bindings ).each( function( opt ) {
					$children = view.$( opt.selector );
					($children.length ? $children : view.$el).each( function( index, el ) {
						_( _.isString( opt.attr ) ? [ opt.attr ] : opt.attr ).each( function( attribute, key ) {
							binding = _( {
								$el: $( el ),
								el: el,
								type: opt.type,
								attr: attribute
							} ).defaults( opt );
							if ( _.isString( key ) )
								binding.key = key;

							self.bindings.push( binding );

							boundAttributes = [ binding.attr ];
							_( boundAttributes ).each( function( attr ) {
								self.bindingsIndex[ attr ] || (self.bindingsIndex[ attr ] = []);
								self.bindingsIndex[ attr ].indexOf( binding ) == -1 && self.bindingsIndex[ attr ].push( binding );
							} );
						} );
					} );
				} );

				var hasBindingEl;
				if ( view.$el.attr( 'data-bind' ) )
					parseBinding( view.el );
				while ( hasBindingEl = view.el.querySelector( '[data-bind]' ) )
					parseBinding( hasBindingEl );

				function parseBinding( el ) {

					var $el = $( el );
					var syntax = ($el.attr( 'data-bind' ) || '').replace( /\s+/g, '' );
					bindingRegex.lastIndex = 0;
					$el.removeAttr( 'data-bind' );

					matching : while ( matched = bindingRegex.exec( syntax ) ) {
						type = matched[ 1 ];
						value = matched[ 2 ];

						if ( !type )
							if ( $el.is( 'input[type="checkbox"],input[type="radio"]' ) )
								type = 'checked';
							else if ( $el.is( 'input,select,textarea' ) )
								type = 'value';
							else if ( $el.is( '[contenteditable]' ) )
								type = 'html';
							else
								type = 'text';

						if ( type == 'model' ) {
							_.defer(function( view, value, template ) {
								console.log(value,view)
								var model = view.model.get(value);
								new View({ el: el, template: template, model: model });
							}, view, value, el.innerHTML);

							el.innerHTML = '';
							continue matching;
						}
						if ( type == 'collection' ) {
							_.defer(function( view, value, template ) {
								var collection =  view.model.get( value )
								new CollectionView( { el: el, template: template, collection: collection } );
							}, view, value, el.innerHTML);

							el.innerHTML = '';
							continue matching;
						}

						nested = value.match( /{(.*)}/ );
						value = nested ? nested[ 1 ] : value;
						_( nested ? nested[ 1 ].split( ',' ) : [ value ] ).each( function( string ) {
							split = string.split( ':' );
							binding = {
								$el: $el,
								el: el,
								type: type,
								attr: split.length == 1 ? split[ 0 ] : split[ 1 ]
							}
							if ( split.length == 2 )
								binding.key = split[ 0 ];
							if ( $el.data( 'bind-events' ) )
								binding.events = $el.data( 'bind-events' );

							self.bindings.push( binding );

							boundAttributes = [ binding.attr ];
							_( boundAttributes ).each( function( attr ) {
								self.bindingsIndex[ attr ] || (self.bindingsIndex[ attr ] = []);
								self.bindingsIndex[ attr ].indexOf( binding ) == -1 && self.bindingsIndex[ attr ].push( binding );
							} );
						} );
					}
				}

				_( this.bindings ).each( function( binding ) {
					//binding.$el.on( 'input', { binding: binding }, this.inputEventHandler);
					binding.$el.on( binding.events || 'change', { binding: binding }, this.changeEventHandler );

					binding.$el
						.removeAttr( 'data-bind' )
						.removeAttr( 'data-bind-events' );
				}, this );
			},
			updateView: function( attr, options ) {

				options || (options = {});
				var value, originalValue;

				_( attr ? this.bindingsIndex[ attr ] : this.bindings ).each( function( binding ) {

					value = this.getData( binding.attr );
					if ( value instanceof Backbone.Model || value instanceof Backbone.Collection ) {
						originalValue = value;
						value = value.toJSON();
					}

					if ( this.setters[ binding.type ] ) {
						if ( _.isFunction( binding.parse ) )
							value = binding.parse.call( binding, value, binding.key, this.view );
						this.setters[ binding.type ]( binding.$el, value, binding.key );
					}
				}, this );
			},

			setters: {
				text: function( $el, value ) {
					($el.text() != value) && $el.text( _.isUndefined( value ) ? '' : value );
				},
				html: function( $el, value ) {
					($el.html() != value) && $el.html( _.isUndefined( value ) ? '' : value );
				},
				value: function( $el, value ) {
					($el.val() != value) && $el.val( _.isUndefined( value ) ? '' : value );
				},
				attr: function( $el, value, key ) {
					if ( !key ) return;
					$el.attr( key, value );
				},
				prop: function( $el, value, key ) {
					if ( !key ) return;
					$el.prop( key, value );
				},
				style: function( $el, value, key ) {
					key ? $el.css( key, value ) : $el.css( value || {} );
				},
				class: function( $el, value, key ) {
					$el[ value ? 'addClass' : 'removeClass' ]( key );
				},
				checked: function( $el, value ) {
					$el.attr( 'checked', value );
				},
				enabled: function( $el, value ) {
					$el.attr( 'disabled', !value );
				},
				disabled: function( $el, value ) {
					$el.attr( 'disabled', value );
				},
				toggle: function( $el, value ) {
					$el.toggle( value );
				},
				visible: function( $el, value ) {
					$el.toggle( !!value );
				},
				hidden: function( $el, value ) {
					$el.toggle( !value );
				},
			},
			getters: {
				text: function( $el ) {
					return $el.text();
				},
				html: function( $el ) {
					return $el.html();
				},
				value: function( $el ) {
					return $el.val();
				},
				checked: function( $el ) {
					return $el.prop( 'checked' );
				},
			},

			getData: function( key ) {
				var values = [];
				_.each( this.models, function( model ) {
					var value = model.get( key );
					values.indexOf( value ) == -1 && values.push( value );
				} );
				return values.length < 2 ? values[ 0 ] : '-';
			},
			setData: function( key, value ) {
				_.invoke( this.models, 'set', key, value );
			},

			inputEventHandler: function( e ) {
				return;
				if ( e.data && e.data.binding && e.data.binding.$el.is( e.currentTarget ) ) {
					var binding = e.data.binding;
					if ( this.getters[ binding.type ] ) {
						var value = this.getters[ binding.type ]( binding.$el );
						_.invoke( this.models, 'trigger', 'input', binding.attr, value );
						_.invoke( this.models, 'trigger', 'input:' + binding.attr, value );
					}
				}
			},
			changeEventHandler: function( e ) {
				if ( e.data && e.data.binding && e.data.binding.$el.is( e.currentTarget ) ) {
					var binding = e.data.binding;
					if ( this.getters[ binding.type ] )
						this.setData( binding.attr, this.getters[ binding.type ]( binding.$el, e ) );
				}
			},
			modelChangeHandler: function( model, options ) {
				_( model.changed ).chain().keys().each( function( key ) {
					this.updateView( key, options );
				}, this );
			}

		} );

		return DataBinder;
	}()

	_.extend(Backbone,B)

}( this, jQuery, _, Backbone );