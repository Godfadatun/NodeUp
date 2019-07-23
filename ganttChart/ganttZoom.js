Ganttalendar.prototype.initZoomlevels = function() {
    var self = this;

    this.zoomLevels = [];
    this.zoomDrawers = {};

    function _addZoom(zoom, zoomDrawer) {
        self.zoomLevels.push(zoom);
        self.zoomDrawers[zoom] = zoomDrawer;
        self.zoomDrawers[zoom].computedScaleX = 600 / millisFromString(zoom);
    }
    //-----------------------------  2 WEEKS  600px -----------------------------
    _addZoom("2w", {
        adjustDates: function(start, end) {
            start.setFirstDayOfThisWeek();
            start.setDate(start.getDate() - 7);
            end.setFirstDayOfThisWeek();
            end.setDate(end.getDate() + 20);
        },
        row1: function(date, tr1) {
            var start = new Date(date.getTime());
            date.setDate(date.getDate() + 6);
            self.createHeadCell(1, this, tr1, start.format("MMM d") + " - " + date.format("MMM d 'yy") + " (" + GanttMaster.messages["GANTT_WEEK_SHORT"] + date.format("w") + ")", 7, "", start, date);
            date.setDate(date.getDate() + 1);
        },
        row2: function(date, tr2, trBody) {
            var start = new Date(date.getTime());
            date.setDate(date.getDate() + 1);
            var holyClass = isHoliday(start) ? "holy" : "";
            self.createHeadCell(2, this, tr2, start.format("EEEE").substr(0, 1), 1, "headSmall " + holyClass, start, date);
            self.createBodyCell(this, trBody, 1, start.getDay() % 7 == (self.master.firstDayOfWeek + 6) % 7, holyClass);
        }
    });
    //-----------------------------  1 MONTH  600px  -----------------------------
    _addZoom("1M", {
        adjustDates: function(start, end) {
            start.setMonth(start.getMonth() - 1);
            start.setDate(15);
            end.setDate(1);
            end.setMonth(end.getMonth() + 1);
            end.setDate(end.getDate() + 14);
        },
        row1: function(date, tr1) {
            var start = new Date(date.getTime());
            date.setDate(1);
            date.setMonth(date.getMonth() + 1);
            date.setDate(date.getDate() - 1);
            var inc = date.getDate() - start.getDate() + 1;
            date.setDate(date.getDate() + 1);
            self.createHeadCell(1, this, tr1, start.format("MMMM yyyy"), inc, "", start, date); //spans mumber of dayn in the month
        },
        row2: function(date, tr2, trBody) {
            var start = new Date(date.getTime());
            date.setDate(date.getDate() + 1);
            var holyClass = isHoliday(start) ? "holy" : "";
            self.createHeadCell(2, this, tr2, start.format("d"), 1, "headSmall " + holyClass, start, date);
            var nd = new Date(start.getTime());
            nd.setDate(start.getDate() + 1);
            self.createBodyCell(this, trBody, 1, nd.getDate() == 1, holyClass);
        }
    });
};