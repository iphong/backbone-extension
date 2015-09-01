# Backbone extension

### Models

Define a nested model structure is simple and straight forwards.

```javascript
var AddressBook = B.Model({
    entries: B.Collection([
        B.Model({
            favorite: false,
            name: B.Model({ first: '', last: '' }),
            phones: B.Collection( B.Model({
                type: 'home',
                number: '123-456-789'
            })),
            addresses: B.Collection([
                B.Model({
                    address: '',
                    city: '',
                    state: 'CA',
                    zipcode: 'CA',
                    country: 'USA'
                })
            ]),
            notes: B.Collection(B.Model({
                time: 09278143992,
                memo: ''
            }))
        })
    ])
});
```

Create an empty instance

```javascript
var addressBook = new AddressBook;
```

Add new entry

```javascript
addressBook.get('entries').add({
    name: { first: 'Steve' },
    phones: [
        { type: 'mobile', number: '+1 (999) 999-9999' }
    ]
});
addressBook.get('entries[0].phones').add({
    type: 'mobile',
    number: '+1 (888) 888-8888'
});
```

Modify an entry

```javascript
addressBook.set('entries[0].name.last', 'Jobs')
```

Listen to model events 

```javascript
addressBook.on('change:entries.favorite', updateFavorites);
// Events chain
// change
// change:entries
// change:entries.favorite
// change:entries[0]
// change:entries[0].favorite
// change:entries[0].phones[0].number
// change:entries[0].phones.number
// change:entries.phones[0].number
// change:entries.phones.number
```
