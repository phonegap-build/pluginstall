var path = require('path'),
    mkdirp = require('mkdirp'),
    fs = require('fs'),
    et = require('elementtree'),
    glob = require('glob'),
    xcode = require('xcode'),
    plist = require('plist'),
    nCallbacks = require('../util/ncallbacks'),
    asyncCopy = require('../util/asyncCopy'),
    getConfigChanges = require('../util/config-changes'),
    searchAndReplace = require('../util/searchAndReplace'),
    xmlHelper = require('../util/xml-helpers'),
    assetsDir = 'www'; // relative path to project's web assets

exports.installPlugin = function (config, plugin, callback) {
    function prepare(then) {
        var store = {},
            end = nCallbacks(3, function (err) {
                if (err) throw err;

                else
                    then(store.pbxPath, store.xcodeproj, store.cordovaPListPath,
                        store.cordovaPList, store.plistPath, store.plist, store.pluginsDir, store.xcodeProjectPath);
            });

        // grab and parse pbxproj
        glob(config.projectPath + '/*/project.pbxproj', function (err, files) {
            if (!files.length) throw "does not appear to be an xcode project";

            files = files.filter(function (val) {
                return !(/\/CordovaLib.*\/project[.]pbxproj/.test(val))
            });

            store.pbxPath = files[0];
            store.xcodeproj = xcode.project(files[0]);
            store.xcodeproj.parse(end);
        });

        glob(config.projectPath + '/*/{PhoneGap,Cordova}.plist', function (err, files) {
            if (!files.length) throw "does not appear to be a PhoneGap project";

            files = files.filter(function (val) {
                return !(/^build\//.test(val))
            });

            store.cordovaPListPath = files[0];
            store.pluginsDir = path.resolve(files[0], '..', 'Plugins');

            plist.parseFile(store.cordovaPListPath, function (err, obj) {
                store.cordovaPList = obj;
                end();
            });
        });
        
        // grab and parse project plist file
        glob(config.projectPath + '/*/*-Info.plist', function (err, files) {
            if (!files.length) throw "does not appear to be a PhoneGap project";

            files = files.filter(function (val) {
                return !(/^build\//.test(val))
            });

            store.plistPath = files[0];
            store.xcodeProjectPath = path.dirname(files[0]);

            plist.parseFile(store.plistPath, function (err, obj) {
                store.plist = obj;
                end();
            });
        });
    }

    function getRelativeDir(file) {
        var targetDir = file.attrib['target-dir'],
            preserveDirs = file.attrib['preserve-dirs'];

        if (preserveDirs && preserveDirs.toLowerCase() == 'true') {
            return path.dirname(file.attrib['src']);
        } else if (targetDir) {
            return targetDir;
        } else {
            return '';
        }
    }

    prepare(function (pbxPath, xcodeproj, cordovaPListPath, cordovaPListObj, plistPath, plistObj, pluginsDir, xcodeProjectPath) {
        var assets = plugin.xmlDoc.findall('./asset'),
            hosts = plugin.xmlDoc.findall('./access'),
            platformTag = plugin.xmlDoc.find('./platform[@name="ios"]'),
            sourceFiles = platformTag.findall('./source-file'),
            headerFiles = platformTag.findall('./header-file'),
            resourceFiles = platformTag.findall('./resource-file'),
            frameworks = platformTag.findall('./framework'),
            plistEle = platformTag.find('./plugins-plist'),
            configChanges = getConfigChanges(platformTag),
            callbackCount = 0, end;

        // callback for every file/dir to add
        callbackCount += assets.length;
        callbackCount += sourceFiles.length;
        callbackCount += headerFiles.length;
        callbackCount += resourceFiles.length;
        callbackCount += Object.keys(configChanges).length;
        callbackCount++; // for writing the pbxproj file

        end = nCallbacks(callbackCount, function(err) {
          if (err) throw err;

          for (key in config.variables) {
            searchAndReplace(xcodeProjectPath + '/{PhoneGap,Cordova}.plist', 
              '\\$' + key,
              config.variables[key]
            );
            searchAndReplace(xcodeProjectPath + '/*-Info.plist', 
              '\\$' + key,
              config.variables[key]
            );
            searchAndReplace(xcodeProjectPath + '/config.xml', 
              '\\$' + key,
              config.variables[key]
            );
          }
          callback();
        });

        // move asset files into www
        assets.forEach(function (asset) {
            var srcPath = path.resolve(
                            config.pluginPath, asset.attrib['src']);

            var targetPath = path.resolve(
                                config.projectPath,
                                assetsDir, asset.attrib['target']);

            asyncCopy(srcPath, targetPath, end);
        });

        // move native files (source/header/resource)
        sourceFiles.forEach(function (sourceFile) {
            var src = sourceFile.attrib['src'],
                srcFile = path.resolve(config.pluginPath, 'src/ios', src),
                targetDir = path.resolve(pluginsDir, getRelativeDir(sourceFile)),
                destFile = path.resolve(targetDir, path.basename(src)),
                targetFile = 'Plugins/' + path.relative(pluginsDir, destFile);

            if (/[.]a$/.test(src)) {
                xcodeproj.addStaticLibrary(targetFile, { plugin: true });
            } else {
                xcodeproj.addSourceFile(targetFile);
            }

            mkdirp(targetDir, function (err) {
                asyncCopy(srcFile, destFile, end);
            })
        })

        headerFiles.forEach(function (headerFile) {
            var src = headerFile.attrib['src'],
                srcFile = path.resolve(config.pluginPath, 'src/ios', src),
                targetDir = path.resolve(pluginsDir, getRelativeDir(headerFile)),
                destFile = path.resolve(targetDir, path.basename(src));

            xcodeproj.addHeaderFile('Plugins/' + path.relative(pluginsDir, destFile));

            mkdirp(targetDir, function (err) {
                asyncCopy(srcFile, destFile, end);
            })
        })

        resourceFiles.forEach(function (resource) {
            var src = resource.attrib['src'],
                srcFile = path.resolve(config.pluginPath, 'src/ios', src),
                destFile = path.resolve(pluginsDir, path.basename(src));

            xcodeproj.addResourceFile('Plugins/' + path.basename(src),
                                        { plugin: true });

            asyncCopy(srcFile, destFile, end);
        })

        frameworks.forEach(function (framework) {
            var src = framework.attrib['src'],
                weak = framework.attrib['weak'];
            
            var opt = { weak: (weak && weak.toLowerCase() == 'true') };
            xcodeproj.addFramework(src, opt);
        });

        // handle cordova plist (DEPRECATED CORDOVA 2.3+)
        if (cordovaPListObj) {

          if (cordovaPListObj[0]) cordovaPListObj = cordovaPListObj[0];
          
          hosts.forEach(function(host) {
            cordovaPListObj.ExternalHosts.push(host.attrib['origin']);
          });

          // add plugin to cordova plist
          if (plistEle)
            cordovaPListObj.Plugins[plistEle.attrib['key']] = plistEle.attrib['string'];

          // write out cordova plist
          fs.writeFileSync(cordovaPListPath, plist.stringify(cordovaPListObj));
        }
        
        var files = glob.sync(xcodeProjectPath + '/config.xml');

        if (files.length) {
          var xmlDoc = xmlHelper.readAsETSync(files[0]),
              selector = "./";
              
          if (!xmlHelper.addToDoc(xmlDoc, hosts, selector)) {
            throw 'failed to add children to ' + filename;
          }
          
          output = xmlDoc.write({indent: 4});
          fs.writeFileSync(files[0], output);
        }

        // add package name to variables for substitution
        if (plistObj[0]) plistObj = plistObj[0];
        config.variables["PACKAGE_NAME"] = plistObj.CFBundleIdentifier;

        // add config-file item to files
        Object.keys(configChanges).forEach(function (filenameGlob) {
          
          // TO FIX: assuming only one file match!!!!! (cos im lazy)
          var files = glob.sync(xcodeProjectPath + '/' + filenameGlob);
          if (files.length) {
            var filename = files[0];
          
            if (/.plist$/i.test(filename)) {
              appendToPList(filename, configChanges[filenameGlob], end);
            
            } else if (/.xml$/i.test(filename)) {
              appendToXML(filename, configChanges[filenameGlob], end);
            
            } else {
              end("unsupported configuration file type:"+filename);
            
            }
          }
          else 
            end();
          
        });

        // write out xcodeproj file
        fs.writeFile(pbxPath, xcodeproj.writeSync(), end);
    });
}

function appendToXML(filename, configNodes, end){
  var xmlDoc = xmlHelper.readAsETSync(filename),
      output;

  configNodes.forEach(function (configNode) {
    var selector = configNode.attrib["parent"],
        children = configNode.findall('*');

    if (!xmlHelper.addToDoc(xmlDoc, children, selector)) {
      end('failed to add children to ' + filename);
    }
  });

  output = xmlDoc.write({indent: 4});

  fs.writeFile(filename, output, function (err) {
    if (err) end(err);

    end();
  });
  
}

function appendToPList(filename, configNodes, end){

  plist.parseFile(filename, function (err, plistObj) {
    if (err) end(err);
    
    if (plistObj[0]) plistObj = plistObj[0];

    configNodes.forEach(function (configNode) {
      var parent = configNode.attrib['parent'],
          text = et.tostring(configNode.find("./*"), { xml_declaration:false });
        
      plist.parseString(text, function(err, obj) {
        if (err) end(err);

        var node = plistObj[parent]
        if (node && Array.isArray(node) && Array.isArray(obj))
          plistObj[parent] = node.concat(obj);
        else
          plistObj[parent] = obj;
      });
    
    });

    fs.writeFile(filename, plist.stringify(plistObj), function (err) {
      if (err) end(err);

      end();
    });
  });
}

