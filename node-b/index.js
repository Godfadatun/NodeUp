// app.listen() = this starts a server
// app.get sets up the route

var express = require('express');
var app = express();
var port = 4000;

app.get('/', (req, res) => {
    res.json({
        message: 'Sup u sent nothing bro',
        author: 'idiot'
    })
})

app.get('/sup', (req, res) => {
    res.send('u are at sup now')
})

app.get('/happy', (req, res) => {
    res.send('smiles :)')
})


app.listen(port,  () => {
    console.log('Running App on port ' + port);
    
})