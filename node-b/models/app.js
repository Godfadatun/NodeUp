var mongoose = require('mongoose');

var appSchema = new mongoose.Schema({
    name :{
        type: String,
        required: 'Name cannot be blank'
    },
    completed :{
        type: Boolean,
        default: false
    },
    theDate :{
        type: Date,
        default: Date.now
    }
});

var App = mongoose.model('app', appSchema);

module.exports = App;
