// HELPER FUNCTIONS

// strip numbers from a string
_global.stripNums = function(str){
	var chars = ('0123456789').split('');
	for(var i in chars)
		str = str.split(chars[i]).join('');
	return str;
}

// remove a movieclip from an array
Array.prototype.remove = function(mc){
	for(var i in this){
		if(this[i] == mc){
			this.splice(int(i),1);
			return;
		}
	}
}
ASSetPropFlags(Array.prototype,"remove",1); // hide from for...in

// kill a stage movieclip
MovieClip.prototype.kill = function(){
	this.swapDepths(_root.killDepth);
	this.removeMovieClip();
}
ASSetPropFlags(MovieClip.prototype,"kill",1); // hide from for...in