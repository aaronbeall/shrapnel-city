// DEBUGGING STUFF

var debug_mc = _root.createEmptyMovieClip("debug_mc", 123456);

_global._debug = {
	
	clearDrawing:function() {
		//trace("clearDrawing");
		debug_mc.clear();
	},
	
	drawLineFrom:function(xFrom, yFrom, color){
		if (color == undefined) color = 0xFF0000;
		//trace("drawLineFrom " + [xFrom, yFrom])
		debug_mc.moveTo(xFrom, yFrom);
		debug_mc.lineStyle(1, color );
	},
	
	drawLineTo:function(xTo, yTo){
		//trace("drawLineTo " + [xTo, yTo])
		debug_mc.lineTo(xTo, yTo);
	},
	
	drawLine:function(xFrom, yFrom, xTo, yTo, color){
		if (color == undefined) color = 0xFF0000;
		//trace("drawRect " + [xFrom, yFrom, xTo, yTo]);
		debug_mc.lineStyle(1, color);
		debug_mc.moveTo(xFrom, yFrom);
		debug_mc.lineTo(xTo, yTo);
	},
	
	drawRect:function(x, y, w, h, color){
		if (color == undefined) color = 0xFF0000;
		//trace("drawRect " + [x, y, w, h]);
		debug_mc.lineStyle(1, color);
		debug_mc.moveTo(x, y);
		debug_mc.lineTo(x + w, y);
		debug_mc.lineTo(x + w, y + h);
		debug_mc.lineTo(x, y + h);
		debug_mc.lineTo(x, y);
	},
	
	drawDot:function(x, y, radius, color){
		if (radius == undefined) radius = 1.5;
		if (color == undefined) color = 0xFF0000;
		//trace("drawDot " + [x, y, radius]);
		debug_mc.beginFill(color, 100);
		_debug.drawRect(x - radius, y - radius, radius * 2, radius * 2, color);
		debug_mc.endFill();
	}
}