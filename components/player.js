var spawn = require( 'child_process').spawn;
var config = require( '../config' );
var i18n = require( 'i18n' );
var log = require( 'colog' );
var objectNester = require( 'object-nester' );

var Player = function ( playlist ) {
	var _autoplaying = false;
	var _nowplaying = null;
	var _onPlay = null;
	var _onStop = null;
	var _process = null;
	var _currentPID = 0;

	/*
	 * Only modules listed in this object will be recorded,
	 * everything else is printed to stdout.
	 */
	this._stdout = {
		'IDENTIFY': []
	};
	this._statusline = '';


	playlist.onQueue( function () {
		if( this.autoPlaying() && this.nowPlaying() === null ) {
			this.playNext();
		}
	}.bind( this ) );

	this.playNext = function () {
		if( _process !== null ) {
			this.stop();
		}

		var n = playlist.next();
		if( n !== null ) {
			playlist.popNext();
			this.play( n );
		}
	};

	this.play = function ( item ) {
		_nowplaying = item;

		Object.keys( this._stdout ).forEach( function ( i ) {
			this._stdout[i] = [];
		}.bind( this ) );
		this._statusline = '';

		if ( config.get( 'player.remote' ) ) {
			var cmd = [
				'DISPLAY=' + config.get( 'player.display' ),
				'mplayer',
				'"' +  _nowplaying.uri + '"', // dirty hack
				'-nomsgcolor',
				'-slave',
				'-msgmodule',
				'-identify'
			].join( ' ' );

			_nowplaying.host = config.get( 'player.remotehost' );

			_process = spawn( 'ssh', [
				_nowplaying.host,
				cmd
			] );

			log.success( i18n.__( 'Spawning %s on %s', cmd, _nowplaying.host ) );
		} else {
			_process = spawn( 'mplayer', [
				_nowplaying.uri,
				'-identify',
				'-slave',
				'-msgmodule',
				'-nomsgcolor'
			] );
		}

		if ( _onPlay ) {
			_onPlay.call( this, _nowplaying );
		}

		_currentPID = _process.pid;

		_process.on( 'close', function () {
			_process = null;
			this._notifyStop();
		}.bind( this ) );

		_process.stderr.on( 'data', function ( d ) {
			if ( ! config.get( 'player.quiet' ) ) {
				log.error( d.toString() );
			}
		} );
		_process.stdout.on( 'data', function ( d ) {
			var lines = d.toString().split( '\n' );
			var modexp = /([^\s]*?):\s*(.*)/;
			lines.forEach( function ( l ) {
				var match = modexp.exec( l );
				if ( match ) {
					if ( match[1] === 'STATUSLINE' ) {
						this._statusline = match[2];
					}
					else if ( this._stdout[match[1]] ) {
						this._stdout[match[1]].push( match[2] );
					}
				}
			}.bind( this ) );
		}.bind( this ) );
	};

	this.writeCMD = function( cmd ) {
		if( _process ) {
			_process.stdin.write( cmd + '\n' );
		}
	};

	this.stop = function () {
		if( _process ) {
			_process.removeAllListeners( 'close' );
			_process.kill();
			_process = null;
		}
		this._notifyStop();
	};

	this._notifyStop = function () {
		if( _nowplaying !== null ) {
			playlist.addHistory( _nowplaying );
		}

		if( _onStop ) {
			_onStop.call( this, _nowplaying );
		}
		_nowplaying = null;

		if( this.autoPlaying() ) {
			this.playNext();
		}
	};

	this.nowPlaying = function () {
		return _nowplaying;
	};

	this.setAutoPlaying = function ( playing ) {
		_autoplaying = playing;
		if( this.autoPlaying() && this.nowPlaying() === null ) {
			this.playNext();
		}
	};

	this.autoPlaying = function () {
		return _autoplaying;
	};

	this.metadata = function () {
		var metadata = {};

		this._stdout.IDENTIFY.forEach( function ( line ) {
			var value = line.split( '=' )[1];
			var key = line.split( '=' )[0].toLowerCase();
			key = key.split( '_' );
			if ( key[0] === 'id' ) {
				key.shift();
			}
			objectNester.create( metadata, key, value );
		} );

		return metadata;
	};

	this.status = function () {
		var status = {
			'position': {}
		};

		var audioexp = /A:\s+(\d+\.\d+)/;
		var videoexp = /V:\s+(\d+\.\d+)/;

		var audiomatch = audioexp.exec( this._statusline );
		var videomatch = videoexp.exec( this._statusline );
		if ( audiomatch ) {
			status.position.audio = parseFloat( audiomatch[1] );
		}
		else {
			status.position.audio = null;
		}
		if( videomatch ) {
			status.position.video = parseFloat( videomatch[1] );
		}
		else {
			status.position.video = null;
		}

		return status;
	};

	this.onPlay = function ( cb ) {
		_onPlay = cb;
	};

	this.onStop = function ( cb ) {
		_onStop = cb;
	};
};

module.exports = Player;
