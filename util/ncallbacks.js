/*
 *  stupid-simple "flow control"
 */

module.exports = function nCallbacks(count, callback) {
    var n = count;
    return function (err) {
        if (err) callback(err)
        --n
        if (n == 0) callback(null)
    }
}
