app = new App.View({
	el: '#app',
	model: App.Model({
		title: "Hello",
		tasks: App.Collection()
	}),
	events: {
		'change input': function( e ) {
			app.model.get('tasks').add({
				name: e.target.value,
				items: App.Collection([
					{ name: 'item1' },
					{ name: 'item2' },
					{ name: 'item3' },
				])
			});
			e.target.value = '';
		}
	}
});