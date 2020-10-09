// zipparallel.js
// ================================================================================================
// parallel write multiple output files for common .zip download
// use Chrome or Edge (webkit file API) for large data, other browsers work in memory

(function(){

function ZipParallel(cb) { var I = this
    I.index = []; I.err = null
    I.encoder = new TextEncoder()
    I.error = function(err) { console.log(err); I.err = I.err || err }
    var o = navigator.webkitTemporaryStorage; if (!o) return then() // alternate browser 
    o.requestQuota(1024*1024*1024, grantedBytes=>{ // 1 GB
        window.requestFileSystem = window.requestFileSystem || window.webkitRequestFileSystem
        window.requestFileSystem(window.TEMPORARY, grantedBytes, filesystem=>{
            I.FS = filesystem.root
            I.FS.createReader().readEntries(fileEntries=>{ // remove temp remnants
                function loop() {
                    var fileEntry = fileEntries.shift(); if (!fileEntry) return then()
                    console.log('remove', fileEntry.name)
                    fileEntry.remove(loop)
                }; loop()
            }, then)
        }, I.error)
    }, I.error)
    function then(err) {
        if (err) alert(err)
        if (cb) setTimeout(cb, 0)
    }
}
ZipParallel.prototype.entry = function(file) { var I = this
    if (!/^[\w,\s-]+\.\w+$/.test(file)) throw 'invalid filename: '+file // do not accept subdirs
    if (I.index.find(e=>e.file==file)) throw 'ambiguous file: '+file
    var index = I.index.length, temp = 'ZipParallel'+index // temp file name
    var e = { file, temp, size:0, crc:0, create:true, chunks:[], csize:0 }; I.index.push(e)
    e.zip = new pako.Deflate({ raw:true })
    e.zip.onData = function(chunk) {
        if (I.err) return
        e.chunks.push(chunk)
        e.csize += chunk.length
        if (!I.FS || e.chunks.length>1) return
        I.FS.getFile(e.temp, { create:e.create }, fileEntry=>{
            e.create = false
            fileEntry.createWriter(fileWriter=>{
                if (fileWriter.readyState != 0) console.log('@createWriter', 'readyState'+fileWriter.readyState)
                fileWriter.onerror = I.error
                fileWriter.seek(fileWriter.length)
                fileWriter.write(new Blob(e.chunks))
                e.chunks = []
            }, I.error)
        }, I.error)
    }
    function write(data) {
        if (!data.length) return
        if ('string' == typeof data) data = I.encoder.encode(data)
        e.zip.push(data)
        e.size += data.length; e.crc = Crc32(data, e.crc)
    }
    return { write }                            // return writer instance
}
ZipParallel.prototype.close = function(cb) { var I = this
    var index = 0
    function loop(status) {
        if (status) I.error('onEnd:'+status)
        var e = I.index[index++]; if (!e) return then()
        e.zip.onEnd = loop                      // next index
        e.zip.push('', true)
    }; loop()
    function then() {
        if (!I.err) {
            var bytes = I.index.reduce((t, e)=>{ var n = e.file.length; return t + 30+n + e.csize + 46+n }, 22) // EOCD + (LFH + content + CDFH)
        } else {
            I.index = null                      // disable instance
        }
        cb(I.err, bytes)                        // userdefined sort before download(): ZipParallel.index = ZipParallel.index.sort((a, b)=>a.file<b.file?-1:1)                        // length of result .zip file
    }
}
ZipParallel.prototype.download = function(filename, cb) { var I = this
    var index = 0, fw, d = new Date(), date = dosDate(d), time = dosTime(d), pos = 0, posCD, url
    if (!I.FS) return alternate()               // alternate
    url = 'filesystem:https://'+window.location.host+'/temporary/ZipParallel'
    I.FS.getFile('ZipParallel', { create:true }, fileEntry=>{
        fileEntry.createWriter(fileWriter=>{
            fileWriter.onerror = alert
            fw = fileWriter
            loop()
        }, alert)
    }, alert)
    function loop() {                           // write files
        var e = I.index[index++]; if (!e) return writeCD()
        e.pos = pos
        write(LFH(e), ()=>{
            I.FS.getFile(e.temp, {}, fileEntry=>{
                fileEntry.file(file=>{
                    write(file, ()=>{
                        fileEntry.remove(loop)
                    })
                }, alert)
            }, alert)
        })
    }
    function writeCD() {                        // write central directory
        posCD = pos; index = 0
        function loop2() {
            var e = I.index[index++]; if (!e) return write(EOCD(), finish)
            write(CDFH(e), loop2)
        }; loop2()
    }
    function finish() {                         // trigger download
        var t = document.createElement('a'); t.setAttribute('download', filename); t.setAttribute('href', url)
        document.body.appendChild(t); t.click(); t.remove()
        if (cb) cb()
        setTimeout(()=>{                        // free memory / temporaryStorage
            if (!I.FS) URL.revokeObjectURL(url) // alternate
            else I.FS.getFile('ZipParallel', {}, fileEntry=>{ fileEntry.remove(()=>{}) }, alert)
        }, 5000)
    }
    function write(blob, cb) {
        fw.onwriteend = cb
        fw.write(blob); pos += blob.size
    }

    // see https://en.wikipedia.org/wiki/Zip_(file_format)
    function LFH(e) {                           // local file header
        var v = new DataView(new ArrayBuffer(30 + e.file.length))
        v.setUint32(0, 0x504b0304)              // signature
        v.setUint16(4, 0x14, true)              // empiric: version needed to extract
        v.setUint16(8, 8, true)                 // compression method: 'deflate'
        v.setUint16(10, time, true)             // file last modification time and date
        v.setUint16(12, date, true)             // file last modification time and date
        v.setInt32(14, e.crc, true)             // CRC32 of uncompressed data
        v.setUint32(18, e.csize, true)          // compressed size
        v.setUint32(22, e.size, true)           // uncompressed size
        v.setUint16(26, e.file.length, true)    // file name length
        e.file.split('').forEach((c,i)=>{ v.setUint8(30+i, c.charCodeAt()) }) // file name binary
        return new Blob([v])
    }
    function CDFH(e) {                          // central directory file header
        var v = new DataView(new ArrayBuffer(46 + e.file.length))
        v.setUint32(0, 0x504b0102)              // signature
        v.setUint16(6, 0x0a, true)              // empiric: version needed to extract
        v.setUint16(10, 8, true)                // compression method: 'deflate'
        v.setUint16(12, time, true)             // file last modification time and date
        v.setUint16(14, date, true)             // file last modification time and date
        v.setInt32(16, e.crc, true)             // CRC32 of uncompressed data
        v.setUint32(20, e.csize, true)          // compressed size
        v.setUint32(24, e.size, true)           // uncompressed size
        v.setUint16(28, e.file.length, true)    // file name length
        v.setUint32(42, e.pos, true)            // relative offset of local file header
        e.file.split('').forEach((c,i)=>{ v.setUint8(46+i, c.charCodeAt()) }) // file name binary
        return new Blob([v])
    }
    function EOCD() {                           // end of central directory
        var v = new DataView(new ArrayBuffer(22))
        v.setUint32(0, 0x504b0506)              // signature
        v.setUint16(8, I.index.length, true)    // number of central directory records
        v.setUint16(10, I.index.length ,true)   // total number of central directory records
        v.setUint32(12, pos-posCD, true)        // size of central directory
        v.setUint32(16, posCD, true)            // offset of start of central directory
        return new Blob([v])
    }
    function dosTime(d) { return (((d.getHours() << 6) | d.getMinutes()) << 5) | (d.getSeconds()/2) }
    function dosDate(d) { return ((((d.getFullYear()-1980) << 4) | (d.getMonth()+1)) << 5) | d.getDate() }

    function alternate() {                      // alternate browser
        var arr = []
        I.index.forEach(e=>{
            var h = LFH(e); arr.push(h); pos += h.size
            arr.push.apply(arr, e.chunks); pos += e.csize; delete e.chunks
        })
        posCD = pos
        I.index.forEach(e=>{ arr.push(CDFH(e)) })
        arr.push(EOCD())
        url = URL.createObjectURL(new Blob(arr))
        finish()
    }
}

function Crc32(buf, crc) {                      // testvector: Crc32('The quick brown fox jumps over the lazy dog') = 414fa339
    if (!Crc32.$table) {                        // see https://github.com/Stuk/jszip/blob/master/lib/crc32.js
        Crc32.$table = new Array(256)
        for (var n=0; n<256; n++) { for (var c=n, k=0; k<8; k++) { c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1) }; Crc32.$table[n] = c }
    }
    crc = (crc || 0) ^ -1
    for (var i=0, l=buf.length; i<l; i++) { crc = (crc >>> 8) ^ Crc32.$table[(crc ^ buf[i]) & 0xff] }
    return crc ^ -1                             // signed Int32
}

if (window.ZipParallel) alert('ZipParallel name conflict')
else window.ZipParallel = ZipParallel
})()
