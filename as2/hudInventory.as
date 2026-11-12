// INVENTORY

// vars
var isActive = false;
var activeY = _y;
var inactiveY = _y + _height + 3;
var yVal = _y, xVal = _x;
var yTarget = inactiveY, xTarget = xVal, widthTarget = back_mc._width;
var items = [];

// init
item_mc._visible = false;
arrange();

function onMouseUp(){
	if(Key.isDown(Key.SHIFT)){
		var a = ["yellowKey","blueKey","redKey","greenKey","purpleKey","aquaKey"]
		var b = ["Yellow Keycard","Blue Keycard","Red Keycard","Green Keycard","Purple Keycard","Aqua Keycard"];
		var n = random(a.length);
		addItem(a[n], b[n], _player)
	}else if(Key.isDown(Key.DELETEKEY))
		removeItem(items[random(items.length)].name);
}

// add an item to the inventory
function addItem(name, label, targetMC){
	trace(["addItem", name, label])
	if(targetMC){
		var bounds = targetMC.getBounds(this);
		var from = {
			_x:bounds.xMin + (bounds.xMax - bounds.xMin) / 2, 
			_y:bounds.yMin + (bounds.yMax - bounds.yMin) / 2
		}
	}
	var init = {
		name:name,
		label:label,
		_alpha:from ? 100 : 0,
		from:from
	}
	var d = this.getNextHighestDepth();
	var mc = item_mc.duplicateMovieClip("item_mc" + d, d, init);
	items.push(mc);
	arrange();
}

// remove an item from the inventory by name
function removeItem(name){
	var i = items.length
	while(i--){
		if(items[i].name == name){
			var mc = items[i];
			items.splice(i, 1);
			mc.removeMovieClip();
			break;
		}
	}
	arrange();
}

// use an item
function useItem(name, targetMC){
	var i = items.length;
	while(i--){
		if(items[i].name == name && !items[i].used){
			var mc = items[i];
			break;
		}
	}
	if(!mc)
		return;
	
	if(targetMC){
		var bounds = targetMC.getBounds(this);
		mc.to = {
			_x:bounds.xMin + (bounds.xMax - bounds.xMin) / 2, 
			_y:bounds.yMin + (bounds.yMax - bounds.yMin) / 2
		}
		mc.used = true;
		arrange();
	}else{
		trigger("use:" + name);
		removeItem(name);
	}
}

// check if item is in inventory by name
function hasItem(name){
	for(var i in items)
		if(items[i].name == name)
			return true;
	return false;
}

// check how many items there are
function numItems(name){
	if(!name)
		return items.length;
	var n = 0;
	for(var i in items)
		if(items[i].name == name)
			n++;
	return n;
}

// reset and load inventory
function reset(loadItems){
	while(items.length)
		removeItem(items[0].name);
	
	for(var i = 0; i < loadItems.length; i++)
		addItem(loadItems[i].name, loadItems[i].label);
}

// arrange the layout
function arrange(){
	
	// arrange items
	var currX = item_mc._x, mc;
	for(var i = 0; i < items.length; i++){
		mc = items[i];
		if(mc.used)
			continue;
		if(mc.from){
			mc.to = {_x:currX, _y:mc._y};
			mc._x = mc.from._x;
			mc._y = mc.from._y;
			mc.from = null;
		}else
			mc._x = currX
		currX += mc._width;
	}
	
	// adjust layout and position
	widthTarget = currX + 5;
	xTarget = int(screenWidth / 2 - widthTarget / 2);
	var wasActive = isActive;
	isActive = items.length > 0;
	yTarget = isActive ? activeY : inactiveY;
	
	// skip width animation if inventory is showing for the first time
	if(isActive && !wasActive){
		_visible = true;
		_x = xVal = xTarget;
		back_mc._width = widthTarget;
	}
	
	isTransition = true;
}

// main update function
function update(){
	
	// update transitions if there is any
	if(isTransition)
		transition();
	
	// TODO: update active inventory items
	// - in addItem() specify optional "lifespan" parameter
	// - in update() decrement life on all active inventory
	// - when life is expired, removeItem and trigger "expired:" + name
}

// transition
var isTransition = true;
function transition(){
	
	// layout tweening
	yVal += (yTarget - yVal) / 4;
	xVal += (xTarget - xVal) / 4;
	_x = xVal;
	_y = yVal;
	back_mc._width += (widthTarget - back_mc._width) / 4;
	
	// item fade-in
	var itemTweening = false;
	for(var i in items){
		var mc = items[i];
		if(mc._alpha < 100){
			itemTweening = true;
			mc._alpha += 20
		}else if(mc.to){
			itemTweening = true;
			mc._x += (mc.to._x - mc._x) / 6;
			mc._y += (mc.to._y - mc._y) / 6;
			if(Math.abs(mc._x - mc.to._x) < 2 && Math.abs(mc._y - mc.to._y) < 2){
				if(!mc.used){
					mc._x = mc.to._x;
					mc._y = mc.to._y;
					mc._alpha = 10;
					mc.to = null;
				}else{
					if(mc._xscale > 20)
						mc._xscale = mc._yscale -= 20;
					else{
						trigger("use:" + mc.name);
						removeItem(mc.name);
					}
				}
			}
		}
	}
	
	// completion
	if(!itemTweening && Math.abs(yTarget - yVal) < .1 && Math.abs(xTarget - xVal) < .1 && Math.abs(back_mc._width - widthTarget) < 1){
		_y = yVal = yTarget;
		_x = xVal = xTarget;
		back_mc._width = widthTarget;
		if(!isActive)
			_visible = false;
		isTransition = false;
	}
}