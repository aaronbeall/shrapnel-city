// ACTION NOTIFICATION

_root.shots.push(this);
_root.shots.remove(undefined); // clean up stale notification references

text_txt.text = label.toUpperCase();
text_txt._width = text_txt.textWidth + 15;
text_txt._x = -text_txt._width/2;
back_mc._width = text_txt._width;

var y = _y, targetY = _y - 15;
var EASING = 4, FADE_SPEED = 10;
if(duration == undefined) duration = frameRate * 1;

function update(){
	_y = y += (targetY - y) / EASING;
	if(y - targetY < .1){
		duration--;
		if(duration <= 0){
			_alpha -= FADE_SPEED;
			if(_alpha <= 0){
				_root.shots.remove(this);
				this.removeMovieClip();
			}
		}
	}
}