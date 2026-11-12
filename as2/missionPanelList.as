// UI MISSION PANEL LIST

// params
var ITEM_SPACING = 0;

// build list
var levels = _root.levels;
var mc = item_mc0, currY = 0;
for(var i = 0; i < levels.length; i++){
	if(i > 0)
		mc = attachMovie("missionPanelListItem", "item_mc" + i, i);
	mc._y = currY;
	mc.label = levels[i].name;
	mc.locked = i > (_root.so.data.level || 0);
	mc.index = i;
	currY += mc._height + ITEM_SPACING;
}

// update list