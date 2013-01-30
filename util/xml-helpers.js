var fs = require('fs'),
    et = require('elementtree'),
    equalNodes = require('../util/equalNodes');

// adds nodes to doc at selector
exports.addToDoc = function addToDoc(doc, nodes, selector) {
    var ROOT = /^\/([^\/]*)/,
        ABSOLUTE = /^\/([^\/]*)\/(.*)/,
        parent, tagName, subSelector;

    // handle absolute selector (which elementtree doesn't like)
    if (ROOT.test(selector)) {
        tagName = selector.match(ROOT)[1];
        if (tagName === doc._root.tag) {
            parent = doc._root;

            // could be an absolute path, but not selecting the root
            if (ABSOLUTE.test(selector)) {
                subSelector = selector.match(ABSOLUTE)[2];
                parent = parent.find(subSelector)
            }
        } else {
            return false;
        }
    } else {
        parent = doc.find(selector)
    }

    nodes.forEach(function (node) {
        // check if child is unique first
        if (uniqueChild(node, parent)) {
            parent.append(node);
        }
    });

    return true;
}

function uniqueChild(node, parent) {
    var matchingKids = parent.findall(node.tag),
        i = 0;

    if (matchingKids.length == 0) {
        return true;
    } else  {
        for (i; i < matchingKids.length; i++) {
            if (equalNodes(node, matchingKids[i])) {
                return false;
            }
        }

        return true;
    }
}

exports.readAsETSync = function readAsETSync(filename) {
    var contents = fs.readFileSync(filename, 'utf-8');

    return new et.ElementTree(et.XML(contents));
}