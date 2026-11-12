// MESSAGE POPUP

_root.shots.push(this);

var PADDING = 15, EASING = 4;

// text styling
import TextField.StyleSheet;
var styles:StyleSheet = new TextField.StyleSheet();
styles.parseCSS("strong { display:inline;font-weight:bold;color:#009999; }");
text_txt.styleSheet = styles;

// content and size
text_txt.htmlText = text;
text_txt._height = text_txt.textHeight + 5;
back_mc._width = text_txt._width + PADDING * 2;
back_mc._height = text_txt._height + PADDING * 2;

// center
text_txt._x = -text_txt._width/2;
text_txt._y = -text_txt._height/2;

// move if it overlaps player
if(_player.hitTest(this))
	_y -= _height + PADDING;

// animation
var blur = new flash.filters.BlurFilter(50, 0);
update();
function update(){
	if(blur.blurX < 1){
		filters = [];
	}else{
		filters = [blur];
		blur.blurX /= EASING;
	}
	if(killTriggers.onRollOut){
		if(!_player.core_mc.hitTest(killTriggers.onRollOut))
			hide();
	}
}

function hide(){
	_root.shots.remove(this);
	this.removeMovieClip();
}

if(killTriggers.onTimeout)
	setTimeout(hide, killTriggers.onTimeout * 1000);