function TaskFactory() {
    this.build = function(id, name, code, level, start, duration, collapsed) {
        // Set at beginning of day
        var adjusted_start = computeStart(start);
        var calculated_end = computeEndByDuration(adjusted_start, duration);
        return new Task(id, name, code, level, adjusted_start, calculated_end, duration, collapsed);
    };
}

function Task(id, name, code, level, start, end, duration, collapsed) {
    this.id = id;
    this.name = name;
    this.progress = 0;
    this.progressByWorklog = false;
    this.relevance = 0;
    this.type = "";
    this.typeId = "";
    this.description = "";
    this.code = code;
    this.level = level;
    this.status = "STATUS_UNDEFINED";
    this.depends = "";
    this.start = start;
    this.duration = duration;
    this.end = end;
    this.startIsMilestone = false;
    this.endIsMilestone = false;
    this.collapsed = collapsed;
    // permissions - by default all true, but must be inherited from parent
    this.canWrite = true;
    this.canAdd = true;
    this.canDelete = true;
    this.canAddIssue = true;
    this.rowElement;
    this.ganttElement;
    this.master;
    this.assigs = [];
}

Task.prototype.clone = function() {
    var ret = {};
    for (var key in this) {
        if (typeof(this[key]) != "function")
            if (typeof(this[key]) != "object" || Array.isArray(this[key]))
                ret[key] = this[key];
    }
    return ret;
};

Task.prototype.getAssigsString = function() {
    var ret = "";
    for (var i = 0; i < this.assigs.length; i++) {
        var ass = this.assigs[i];
        var res = this.master.getResource(ass.resourceId);
        if (res) {
            ret = ret + (ret == "" ? "" : ", ") + res.name;
        }
    }
    return ret;
};

Task.prototype.createAssignment = function(id, resourceId, roleId, effort) {
    var assig = new Assignment(id, resourceId, roleId, effort);
    this.assigs.push(assig);
    return assig;
};

//<%---------- SET PERIOD ---------------------- --%>
Task.prototype.setPeriod = function(start, end) {
    if (start instanceof Date) {
        start = start.getTime();
    }

    if (end instanceof Date) {
        end = end.getTime();
    }

    var originalPeriod = {
        start: this.start,
        end: this.end,
        duration: this.duration
    };

    start = computeStart(start);
    end = computeEnd(end);

    var newDuration = recomputeDuration(start, end);

    //if are equals do nothing and return true
    if (start == originalPeriod.start && end == originalPeriod.end && newDuration == originalPeriod.duration) {
        return true;
    }

    if (newDuration == this.duration) { // is shift
        return this.moveTo(start, false, true);
    }

    var wantedStartMillis = start;
    var children = this.getChildren();

    if (this.master.shrinkParent && children.length > 0) {
        var chPeriod = this.getChildrenBoudaries();
        start = chPeriod.start;
        end = chPeriod.end;
    }

    //cannot start after end
    if (start > end) {
        start = end;
    }

    var startBySuperiors = this.computeStartBySuperiors(start);
    if (startBySuperiors != start) {
        return this.moveTo(startBySuperiors, false, true);
    }

    var somethingChanged = false;

    if (this.start != start || this.start != wantedStartMillis) {
        this.start = start;
        somethingChanged = true;
    }

    //set end
    var wantedEndMillis = end;

    if (this.end != end || this.end != wantedEndMillis) {
        this.end = end;
        somethingChanged = true;
    }

    this.duration = recomputeDuration(this.start, this.end);

    //nothing changed exit
    if (!somethingChanged)
        return true;

    //cannot write exit
    if (!this.canWrite) {
        this.master.setErrorOnTransaction("\"" + this.name + "\"\n" + GanttMaster.messages["CANNOT_WRITE"], this);
        return false;
    }

    if (this.hasExternalDep) {
        this.master.setErrorOnTransaction("\"" + this.name + "\"\n" + GanttMaster.messages["TASK_HAS_EXTERNAL_DEPS"], this);
        return false;
    }

    var todoOk = true;
    var deltaPeriod = originalPeriod.duration - this.duration;
    var restricting = deltaPeriod > 0;
    var enlarging = deltaPeriod < 0;
    var restrictingStart = restricting && (originalPeriod.start < this.start);
    var restrictingEnd = restricting && (originalPeriod.end > this.end);

    if (restricting) {
        var bs = Infinity;
        var be = 0;
        for (var i = 0; i < children.length; i++) {

            var ch = children[i];
            if (restrictingEnd) {
                be = Math.max(be, ch.end);
            } else {
                bs = Math.min(bs, ch.start);
            }
        }

        if (restrictingEnd) {
            this.end = Math.max(be, this.end);
        } else {
            this.start = Math.min(bs, this.start);
        }
        this.duration = recomputeDuration(this.start, this.end);
        if (this.master.shrinkParent) {
            todoOk = updateTree(this);
        }

    } else {

        //check global boundaries
        if (this.start < this.master.minEditableDate || this.end > this.master.maxEditableDate) {
            this.master.setErrorOnTransaction("\"" + this.name + "\"\n" + GanttMaster.messages["CHANGE_OUT_OF_SCOPE"], this);
            todoOk = false;
        }
        
        if (todoOk) {
            todoOk = updateTree(this);
        }
    }

    if (todoOk) {
        todoOk = this.propagateToInferiors(end);
    }
    return todoOk;
};

//<%---------- MOVE TO ---------------------- --%>
Task.prototype.moveTo = function(start, ignoreMilestones, propagateToInferiors) {
    if (start instanceof Date) {
        start = start.getTime();
    }

    var originalPeriod = {
        start: this.start,
        end: this.end
    };

    var wantedStartMillis = start;

    //set a legal start
    start = computeStart(start);
    //if depends, start is set to max end + lag of superior
    start = this.computeStartBySuperiors(start);

    var end = computeEndByDuration(start, this.duration);

    //check milestones compatibility
    if (!this.checkMilestonesConstraints(start, end, ignoreMilestones))
        return false;

    if (this.start != start || this.start != wantedStartMillis) {
        this.start = start;
        this.end = end;
        //check global boundaries
        if (this.start < this.master.minEditableDate || this.end > this.master.maxEditableDate) {
            this.master.setErrorOnTransaction("\"" + this.name + "\"\n" + GanttMaster.messages["CHANGE_OUT_OF_SCOPE"], this);
            return false;
        }

        // when moving children you MUST consider WORKING days,
        var panDeltaInWM = getDistanceInUnits(new Date(originalPeriod.start), new Date(this.start));

        //loops children to shift them
        var children = this.getChildren();
        for (var i = 0; i < children.length; i++) {
            var ch = children[i];
            var chStart = incrementDateByUnits(new Date(ch.start), panDeltaInWM);
            ch.moveTo(chStart, false, false);
        }

        if (!updateTree(this)) {
            return false;
        }

        if (propagateToInferiors) {
            this.propagateToInferiors(end);
            var todoOk = true;
            var descendants = this.getDescendant();
            for (var i = 0; i < descendants.length; i++) {
                ch = descendants[i];
                if (!ch.propagateToInferiors(ch.end))
                    return false;
            }
        }
    }
    return true;
};

Task.prototype.checkMilestonesConstraints = function(newStart, newEnd, ignoreMilestones) {
    //if start is milestone cannot be move
    if (!ignoreMilestones && (this.startIsMilestone && newStart != this.start)) {
        //notify error
        this.master.setErrorOnTransaction("\"" + this.name + "\"\n" + GanttMaster.messages["START_IS_MILESTONE"], this);
        return false;
    } else if (!ignoreMilestones && (this.endIsMilestone && newEnd != this.end)) {
        //notify error
        this.master.setErrorOnTransaction("\"" + this.name + "\"\n" + GanttMaster.messages["END_IS_MILESTONE"], this);
        return false;
    } else if (this.hasExternalDep) {
        this.master.setErrorOnTransaction("\"" + this.name + "\"\n" + GanttMaster.messages["TASK_HAS_EXTERNAL_DEPS"], this);
        return false;
    }
    return true;
};

//<%---------- PROPAGATE TO INFERIORS ---------------------- --%>
Task.prototype.propagateToInferiors = function(end) {
    //and now propagate to inferiors
    var todoOk = true;
    var infs = this.getInferiors();
    if (infs && infs.length > 0) {
        for (var i = 0; i < infs.length; i++) {
            var link = infs[i];
            if (!link.to.canWrite) {
            this.master.setErrorOnTransaction(GanttMaster.messages["CANNOT_WRITE"] + "\n\"" + link.to.name + "\"", link.to);
                break;
            }
            todoOk = link.to.moveTo(end, false, true); //this is not the right date but moveTo checks start
            if (!todoOk)
                break;
        }
    }
    return todoOk;
};

//<%---------- COMPUTE START BY SUPERIORS ---------------------- --%>
Task.prototype.computeStartBySuperiors = function(proposedStart) {
    //if depends -> start is set to max end + lag of superior
    var supEnd = proposedStart;
    var sups = this.getSuperiors();
    if (sups && sups.length > 0) {
        supEnd = 0;
        for (var i = 0; i < sups.length; i++) {
            var link = sups[i];
            supEnd = Math.max(supEnd, incrementDateByUnits(new Date(link.from.end), link.lag));
        }
        supEnd += 1;
    }
    return computeStart(supEnd);
};

function updateTree(task) {
    var error;
    //try to enlarge parent
    var p = task.getParent();

    //no parent:exit
    if (!p)
        return true;

    var newStart;
    var newEnd;

    //id shrink start and end are computed on children boundaries
    if (task.master.shrinkParent) {
        var chPeriod = p.getChildrenBoudaries();
        newStart = chPeriod.start;
        newEnd = chPeriod.end;
    } else {
        newStart = p.start;
        newEnd = p.end;

        if (p.start > task.start) {
            newStart = task.start;
        }
        if (p.end < task.end) {
            newEnd = task.end;
        }
    }

    if (p.start != newStart) {
        if (p.startIsMilestone) {
            task.master.setErrorOnTransaction("\"" + p.name + "\"\n" + GanttMaster.messages["START_IS_MILESTONE"], task);
            return false;
        } else if (p.depends) {
            task.master.setErrorOnTransaction("\"" + p.name + "\"\n" + GanttMaster.messages["TASK_HAS_CONSTRAINTS"], task);
            return false;
        }
    }
    if (p.end != newEnd) {
        if (p.endIsMilestone) {
            task.master.setErrorOnTransaction("\"" + p.name + "\"\n" + GanttMaster.messages["END_IS_MILESTONE"], task);
            return false;
        }
    }

    //propagate updates if needed
    if (newStart != p.start || newEnd != p.end) {
        //can write?
        if (!p.canWrite) {
            task.master.setErrorOnTransaction(GanttMaster.messages["CANNOT_WRITE"] + "\n" + p.name, task);
            return false;
        }

        //has external deps ?
        if (p.hasExternalDep) {
            task.master.setErrorOnTransaction(GanttMaster.messages["TASK_HAS_EXTERNAL_DEPS"] + "\n\"" + p.name + "\"", task);
            return false;
        }
        return p.setPeriod(newStart, newEnd);
    }
    return true;
}

Task.prototype.getChildrenBoudaries = function() {
    var newStart = Infinity;
    var newEnd = -Infinity;
    var children = this.getChildren();
    for (var i = 0; i < children.length; i++) {
        var ch = children[i];
        newStart = Math.min(newStart, ch.start);
        newEnd = Math.max(newEnd, ch.end);
    }
    return ({
        start: newStart,
        end: newEnd
    })
}

//<%---------- CHANGE STATUS ---------------------- --%>
Task.prototype.changeStatus = function(newStatus, forceStatusCheck) {
    var cone = this.getDescendant();

    function propagateStatus(task, newStatus, manuallyChanged, propagateFromParent, propagateFromChildren) {
        var oldStatus = task.status;

        //no changes exit
        if (newStatus == oldStatus && !forceStatusCheck) {
            return true;
        }

        var todoOk = true;
        task.status = newStatus;

        if (newStatus == "STATUS_DONE") {

            // cannot close task if open issues
            if (task.master.permissions.cannotCloseTaskIfIssueOpen && task.openIssues > 0) {
                task.master.setErrorOnTransaction(GanttMaster.messages["CANNOT_CLOSE_TASK_IF_OPEN_ISSUE"] + " \"" + task.name + "\"");
                return false;
            }

            if ((manuallyChanged || oldStatus != "STATUS_FAILED")) { //cannot set failed task as closed for cascade - only if changed manually

                //can be closed only if superiors are already done
                var sups = task.getSuperiors();
                for (var i = 0; i < sups.length; i++) {
                    if (sups[i].from.status != "STATUS_DONE" && cone.indexOf(sups[i].from) < 0) { 
                        if (manuallyChanged || propagateFromParent)
                            task.master.setErrorOnTransaction(GanttMaster.messages["GANTT_ERROR_DEPENDS_ON_OPEN_TASK"] + "\n\"" + sups[i].from.name + "\" -> \"" + task.name + "\"");
                        todoOk = false;
                        break;
                    }
                }

                if (todoOk) {
                    // set progress to 100% if needed by settings
                    if (task.master.set100OnClose && !task.progressByWorklog) {
                        task.progress = 100;
                    }

                    //set children as done
                    propagateStatusToChildren(task, newStatus, false);

                    //set inferiors as active
                    propagateStatusToInferiors(task.getInferiors(), "STATUS_ACTIVE");
                }
            } else { 
                todoOk = false;
            }
        } else if (newStatus == "STATUS_ACTIVE") {

            if (manuallyChanged || (oldStatus != "STATUS_FAILED" && oldStatus != "STATUS_SUSPENDED")) { //cannot set failed or suspended task as active for cascade - only if changed manually

                //can be active only if superiors are already done, not only on this task, but also on ancestors superiors
                var sups = task.getSuperiors();

                for (var i = 0; i < sups.length; i++) {
                    if (sups[i].from.status != "STATUS_DONE") {
                        if (manuallyChanged || propagateFromChildren)
                            task.master.setErrorOnTransaction(GanttMaster.messages["GANTT_ERROR_DEPENDS_ON_OPEN_TASK"] + "\n\"" + sups[i].from.name + "\" -> \"" + task.name + "\"");
                        todoOk = false;
                        break;
                    }
                }

                // check if parent is already active
                if (todoOk) {
                    var par = task.getParent();
                    if (par && par.status != "STATUS_ACTIVE") {
                        todoOk = false;
                    }
                }

                if (todoOk) {
                    if (oldStatus == "STATUS_UNDEFINED" || oldStatus == "STATUS_SUSPENDED" || oldStatus == "STATUS_WAITING") {
                        //set children as active
                        propagateStatusToChildren(task, newStatus, true);
                    }

                    //set inferiors as suspended
                    propagateStatusToInferiors(task.getInferiors(), "STATUS_WAITING");
                }
            } else {
                todoOk = false;
            }
        } else if (newStatus == "STATUS_WAITING") {
            if (manuallyChanged || oldStatus != "STATUS_FAILED") { //cannot set failed task as waiting for cascade - only if changed manually

                //check if parent if not active
                var par = task.getParent();
                if (par && (par.status != "STATUS_ACTIVE" && par.status != "STATUS_SUSPENDED" && par.status != "STATUS_WAITING")) {
                    todoOk = false;
                }

                if (todoOk) {
                    //set children as STATUS_WAITING
                    propagateStatusToChildren(task, "STATUS_WAITING", true);

                    //set inferiors as STATUS_WAITING
                    propagateStatusToInferiors(task.getInferiors(), "STATUS_WAITING");
                }
            } else {
                todoOk = false;
            }
        } else if (newStatus == "STATUS_SUSPENDED") {
            if (manuallyChanged || oldStatus != "STATUS_FAILED") { //cannot set failed task as closed for cascade - only if changed manually

                //check if parent if not active
                var par = task.getParent();
                if (par && (par.status != "STATUS_ACTIVE" && par.status != "STATUS_SUSPENDED" && par.status != "STATUS_WAITING")) {
                    todoOk = false;
                }

                if (todoOk) {
                    //set children as STATUS_SUSPENDED
                    propagateStatusToChildren(task, "STATUS_SUSPENDED", true);

                    //set inferiors as STATUS_SUSPENDED
                    propagateStatusToInferiors(task.getInferiors(), "STATUS_SUSPENDED");
                }
            } else {
                todoOk = false;
            }
        } else if (newStatus == "STATUS_FAILED" || newStatus == "STATUS_UNDEFINED") {

            //set children as failed or undefined
            propagateStatusToChildren(task, newStatus, false);

            //set inferiors as failed
            propagateStatusToInferiors(task.getInferiors(), newStatus);
        }
        if (!todoOk) {
            task.status = oldStatus;
        }

        return todoOk;
    }

    function propagateStatusToInferiors(infs, status) {
        for (var i = 0; i < infs.length; i++) {
            propagateStatus(infs[i].to, status, false, false, false);
        }
    }

    function propagateStatusToChildren(task, newStatus, skipClosedTasks) {
        var chds = task.getChildren();
        for (var i = 0; i < chds.length; i++)
            if (!(skipClosedTasks && chds[i].status == "STATUS_DONE"))
                propagateStatus(chds[i], newStatus, false, true, false);
    }

    var manuallyChanged = true;

    var oldStatus = this.status;
    //first call
    if (propagateStatus(this, newStatus, manuallyChanged, false, false)) {
        return true;
    } else {
        this.status = oldStatus;
        return false;
    }
};

Task.prototype.synchronizeStatus = function() {
    var oldS = this.status;
    this.status = this.getParent() ? this.getParent().status : "STATUS_UNDEFINED";
    return this.changeStatus(oldS, true);
};

Task.prototype.isLocallyBlockedByDependencies = function() {
    var sups = this.getSuperiors();
    var blocked = false;
    for (var i = 0; i < sups.length; i++) {
        if (sups[i].from.status != "STATUS_DONE") {
            blocked = true;
            break;
        }
    }
    return blocked;
};

//<%---------- TASK STRUCTURE ---------------------- --%>
Task.prototype.getRow = function() {
    ret = -1;
    if (this.master)
        ret = this.master.tasks.indexOf(this);
    return ret;
};

Task.prototype.getParents = function() {
    var ret;
    if (this.master) {
        var topLevel = this.level;
        var pos = this.getRow();
        ret = [];
        for (var i = pos; i >= 0; i--) {
            var par = this.master.tasks[i];
            if (topLevel > par.level) {
                topLevel = par.level;
                ret.push(par);
            }
        }
    }
    return ret;
};

Task.prototype.getParent = function() {
    var ret;
    if (this.master) {
        for (var i = this.getRow(); i >= 0; i--) {
            var par = this.master.tasks[i];
            if (this.level > par.level) {
                ret = par;
                break;
            }
        }
    }
    return ret;
};

Task.prototype.isParent = function() {
    var ret = false;
    if (this.master) {
        var pos = this.getRow();
        if (pos < this.master.tasks.length - 1)
            ret = this.master.tasks[pos + 1].level > this.level;
    }
    return ret;
};

Task.prototype.getChildren = function() {
    var ret = [];
    if (this.master) {
        var pos = this.getRow();
        for (var i = pos + 1; i < this.master.tasks.length; i++) {
            var ch = this.master.tasks[i];
            if (ch.level == this.level + 1)
                ret.push(ch);
            else if (ch.level <= this.level) // exit loop if parent or brother
                break;
        }
    }
    return ret;
};

Task.prototype.getDescendant = function() {
    var ret = [];
    if (this.master) {
        var pos = this.getRow();
        for (var i = pos + 1; i < this.master.tasks.length; i++) {
            var ch = this.master.tasks[i];
            if (ch.level > this.level)
                ret.push(ch);
            else
                break;
        }
    }
    return ret;
};

Task.prototype.getSuperiors = function() {
    var ret = [];
    var task = this;
    if (this.master) {
        ret = this.master.links.filter(function(link) {
            return link.to == task;
        });
    }
    return ret;
};

Task.prototype.getSuperiorTasks = function() {
    var ret = [];
    var sups = this.getSuperiors();
    for (var i = 0; i < sups.length; i++)
        ret.push(sups[i].from);
    return ret;
};

Task.prototype.getInferiors = function() {
    var ret = [];
    var task = this;
    if (this.master) {
        ret = this.master.links.filter(function(link) {
            return link.from == task;
        });
    }
    return ret;
};

Task.prototype.getInferiorTasks = function() {
    var ret = [];
    var infs = this.getInferiors();
    for (var i = 0; i < infs.length; i++)
        ret.push(infs[i].to);
    return ret;
};

Task.prototype.deleteTask = function() {
    //if is the current one remove it
    if (this.master.currentTask && this.master.currentTask.id == this.id)
        delete this.master.currentTask;

    //delete both dom elements if exists
    if (this.rowElement)
        this.rowElement.remove();
    if (this.ganttElement)
        this.ganttElement.remove();

    //remove children
    var chd = this.getChildren();
    for (var i = 0; i < chd.length; i++) {
        //add removed child in list
        chd[i].deleteTask();
    }

    if (!this.isNew())
        this.master.deletedTaskIds.push(this.id);

    //remove from in-memory collection
    this.master.tasks.splice(this.getRow(), 1);

    //remove from links
    var task = this;
    this.master.links = this.master.links.filter(function(link) {
        return link.from != task && link.to != task;
    });
};

Task.prototype.isNew = function() {
    return (this.id + "").indexOf("tmp_") == 0;
};

Task.prototype.isDependent = function(t) {
    var task = this;
    var dep = this.master.links.filter(function(link) {
        return link.from == task;
    });

    // is it a direct dependency?
    for (var i = 0; i < dep.length; i++) {
        if (dep[i].to == t)
            return true;
    }
    // is it an indirect dependency
    for (var i = 0; i < dep.length; i++) {
        if (dep[i].to.isDependent(t)) {
            return true;
        }
    }
    return false;
};

Task.prototype.setLatest = function(maxCost) {
    this.latestStart = maxCost - this.criticalCost;
    this.latestFinish = this.latestStart + this.duration;
};

//<%------------------------------------------  INDENT/OUTDENT --------------------------------%>
Task.prototype.indent = function() {
    //a row above must exist
    var row = this.getRow();

    //no row no party
    if (row <= 0)
        return false;

    var ret = false;
    var taskAbove = this.master.tasks[row - 1];
    var newLev = this.level + 1;
    if (newLev <= taskAbove.level + 1) {
        ret = true;

        //trick to get parents after indent
        this.level++;
        var futureParents = this.getParents();
        this.level--;

        var oldLevel = this.level;
        for (var i = row; i < this.master.tasks.length; i++) {
            var desc = this.master.tasks[i];
            if (desc.level > oldLevel || desc == this) {
                desc.level++;
                //remove links from this and descendant to my parents
                this.master.links = this.master.links.filter(function(link) {
                    var linkToParent = false;
                    if (link.to == desc)
                        linkToParent = futureParents.indexOf(link.from) >= 0;
                    else if (link.from == desc)
                        linkToParent = futureParents.indexOf(link.to) >= 0;
                    return !linkToParent;
                });
                //remove links from this and descendants to predecessors of parents in order to avoid loop
                var predecessorsOfFutureParents = [];
                for (var j = 0; j < futureParents.length; j++)
                    predecessorsOfFutureParents = predecessorsOfFutureParents.concat(futureParents[j].getSuperiorTasks());

                this.master.links = this.master.links.filter(function(link) {
                    var linkToParent = false;
                    if (link.from == desc)
                        linkToParent = predecessorsOfFutureParents.indexOf(link.to) >= 0;
                    return !linkToParent;
                });

            } else
                break;
        }

        var parent = this.getParent();
        // set start date to parent' start if no deps
        if (parent && !this.depends) {
            var new_end = computeEndByDuration(parent.start, this.duration);
            this.master.changeTaskDates(this, parent.start, new_end);
        }

        //recompute depends string
        this.master.updateDependsStrings();
        //enlarge parent using a fake set period
        updateTree(this);
        //force status check starting from parent
        this.getParent().synchronizeStatus();
    }
    return ret;
};

Task.prototype.outdent = function() {
    //a level must be >1 -> cannot escape from root
    if (this.level <= 1)
        return false;

    var ret = false;
    var oldLevel = this.level;

    ret = true;
    var row = this.getRow();
    for (var i = row; i < this.master.tasks.length; i++) {
        var desc = this.master.tasks[i];
        if (desc.level > oldLevel || desc == this) {
            desc.level--;
        } else
            break;
    }

    var task = this;
    var chds = this.getChildren();
    //remove links from me to my new children
    this.master.links = this.master.links.filter(function(link) {
        var linkExist = (link.to == task && chds.indexOf(link.from) >= 0 || link.from == task && chds.indexOf(link.to) >= 0);
        return !linkExist;
    });

    //enlarge me if inherited children are larger
    for (var i = 0; i < chds.length; i++) {
        //remove links from me to my new children
        chds[i].setPeriod(chds[i].start + 1, chds[i].end + 1);
    }

    //recompute depends string
    this.master.updateDependsStrings();

    //enlarge parent using a fake set period
    this.setPeriod(this.start + 1, this.end + 1);

    //force status check
    this.synchronizeStatus();
    return ret;
};


Task.prototype.canStatusBeChangedTo = function(newStatus) {
    if (newStatus == this.status)
        return true;

    var parent = this.getParent();

    //---------------------------------------------------------------------- STATUS_DONE ----------------------------------------------------------------
    if ("STATUS_DONE" == newStatus) {
        if (!parent)
            return true;

        if ("STATUS_FAILED" == parent.status || "STATUS_UNDEFINED" == parent.status)
            return false;

        var sups = this.getSuperiorTasks();
        for (var i = 0; i < sups.length; i++) {
            if ("STATUS_DONE" != sups[i].status) { 
                return false;
            }
        }
        return true;

        //---------------------------------------------------------------------- STATUS_ACTIVE ----------------------------------------------------------------
    } else if ("STATUS_ACTIVE" == newStatus) {
        if (!parent)
            return true;

        if (!"STATUS_ACTIVE" == parent.status)
            return false;

        var sups = this.getSuperiorTasks();
        for (var i = 0; i < sups.length; i++) {
            if ("STATUS_DONE" != sups[i].status) { 
                return false;
            }
        }
        return true;

        //---------------------------------------------------------------------- STATUS_WAITING ----------------------------------------------------------------
    } else if ("STATUS_WAITING" == newStatus) {
        if (!parent)
            return false;

        if ("STATUS_FAILED" == parent.status || "STATUS_UNDEFINED" == parent.status)
            return false;

        if ("STATUS_WAITING" == parent.status)
            return true;

        var sups = this.getSuperiorTasks();
        for (var i = 0; i < sups.length; i++) {
            if ("STATUS_WAITING" == sups[i].status || "STATUS_ACTIVE" == sups[i].status) {
                return true;
            }
        }
        return false;

        //---------------------------------------------------------------------- STATUS_SUSPENDED ----------------------------------------------------------------
    } else if ("STATUS_SUSPENDED" == newStatus) {
        if (!parent)
            return true;

        if ("STATUS_UNDEFINED" == parent.status || "STATUS_FAILED" == parent.status)
            return false;
        return true;

        //---------------------------------------------------------------------- STATUS_FAILED ----------------------------------------------------------------
    } else if ("STATUS_FAILED" == newStatus) {
        return true;

        //---------------------------------------------------------------------- STATUS_UNDEFINED ----------------------------------------------------------------
    } else if ("STATUS_UNDEFINED" == newStatus) {
        return true;
    }
    return false;
};

//<%------------------------------------------------------------------------  LINKS OBJECT ---------------------------------------------------------------%>
function Link(taskFrom, taskTo, lagInWorkingDays) {
    this.from = taskFrom;
    this.to = taskTo;
    this.lag = lagInWorkingDays;
}

//<%------------------------------------------------------------------------  ASSIGNMENT ---------------------------------------------------------------%>
function Assignment(id, resourceId, roleId, effort) {
    this.id = id;
    this.resourceId = resourceId;
    this.roleId = roleId;
    this.effort = effort;
}

//<%------------------------------------------------------------------------  RESOURCE ---------------------------------------------------------------%>
function Resource(id, name) {
    this.id = id;
    this.name = name;
}

//<%------------------------------------------------------------------------  ROLE ---------------------------------------------------------------%>
function Role(id, name) {
    this.id = id;
    this.name = name;
}