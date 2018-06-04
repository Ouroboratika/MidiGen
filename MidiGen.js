'use strict';

/**
 * Potential future ideas:
 * Use Markov chains for chord progressions and scales as well
 * Use fourier transforms instead of/in addition to sine waves
 * Use chord progressions as another parameter to generate melodies
 * Use scales to generate chord progressions
 * Add more chord options
 * Arpeggiate chords
 */

const scribble = require('scribbletune');
const fs = require('fs');
const util = require('util');
const _ = require('lodash');

// Add additional modes not included in Scribbletune by default
// See node_modules/scribbletune/src/modes.js for a list of all available modes
scribble.modes['bebop harmonic minor'] = [1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 1];

// Don't use 0 to prevent value from being evaluated as false
const PatternType = {
    Markov: 1,
    Manual: 2,
    Swing: 3,
    Random: 4,
    Normal: 5
}

// This is used to generate patterns using Markov chains
// Row and column indexes correspond to number of rests
// i.e. row 1, col 2 is the probability that 1 rest changes to 2 rests
// All rows should add up to 1 (100%)
const ProbabilityMatrix = 
    [[.70, .20, .07, .03],
     [.30, .50, .15, .05],
     [.20, .40, .20, .20],
     [.10, .20, .50, .20]]

/**
 * Utility function to combine an array of arrays into a single array
 * @param {array} array 
 */
function flatten(array) {
    return array.reduce((a, b) => a.concat(b), [])
}

// See http://setosa.io/ev/markov-chains/ for a good primer on Markov Chains

class MarkovNode {
    /**
     * A node in the chain containing the node value and a list of links that the node can transition to 
     * @param {any} value The value that will be returned if this node is selected as the current state
     */
    constructor(value) {
        this.value = value;
        this.links = [];
    }
}

class MarkovLink {
    /**
     * A link in the chain that defines when the underlying node should be selected
     * @param {MarkovNode} node 
     * @param {number} lowerBound The lowest value (inclusive) from the random number generator that should select this value (0 <= lowerBound <= 1)
     * @param {number} upperBound The highest value (exclusive) from the random number generator that should select this value (0 <= upperBound <= 1)
     */
    constructor(node, lowerBound, upperBound) {
        this.transitionNode = node;
        this.transitionLowerBound = lowerBound;
        this.transitionUpperBound = upperBound;
    }
}

class MarkovChain {
    /**
     * A Markov chain that will select a new node in the chain every time getNextState is called
     * @param {MarkovNode} initialState The node representing the first state of the chain
     */
    constructor(initialState) {
        this.currentState = initialState;
    }

    /**
     * Adds a link to the chain
     * @param {MarkovNode} baseNode The node which the new node can transition from
     * @param {MarkovNode} newNode The node which can be transitioned to from the base node
     * @param {number} lowerBound The lowest value (inclusive) from the random number generator that should select the new node (0 <= lowerBound <= 1)
     * @param {number} upperBound The highest value (exclusive) from the random number generator that should select the new node (0 <= upperBound <= 1)
     */
    addLink(baseNode, newNode, lowerBound, upperBound) {
        baseNode.links.push(new MarkovLink(newNode, lowerBound, upperBound));
    }

    /**
     * Returns the value of the next selected Markov node
     * @returns {any} the value of the selected node
     */
    getNextState() {
        var choice = Math.random();
        var newState;
        this.currentState.links.forEach(function(link) {
            if (choice >= link.transitionLowerBound && choice < link.transitionUpperBound) {
                newState = link.transitionNode;
                return false;
            }
        });
        this.currentState = newState;
        return this.currentState.value;
    }
}

/**
 * A generator which yields y values of the function y = sin(pi * x) + 1
 * @param {Generator} deltaX A generator that returns the increase in x value each time it's called
 * @returns {number} The new y value 
 */
function* SinGenerator(deltaX) {
    var pos = 0;
    while (true) {
        yield Math.sin(Math.PI * pos) + 1;
        pos += deltaX.next().value;
    }
}

/**
 * Returns a new array which is the array copied numRepeats times
 * @param {array} array The array to repeat
 * @param {number} numRepeats 
 */
function repeatArray(array, numRepeats) {
    return flatten(_.range(numRepeats).map(i => array))
}

/**
 * Generates a list of notes chosen by the sine wave function
 * @param {Generator} deltaX A generator that returns the increase in x value each time it's called
 * @param {string[]} referenceNotes A list of notes that can be chosen by the sine wave generator
 * @param {number} noteCount The number of notes to generate
 * @param {number} maxDistance The maximum change between consecutive notes allowed. If this value is exceeded, a different note will be chosen at random
 * @returns {string[]} The notes generated
 */
function getNotes(deltaX, referenceNotes, noteCount, maxDistance = null) {
    // The maximum y value that the sine equation can generate
    const MAX_Y = 2;
    const PRECISION = 10;
    if (maxDistance === null) {
        maxDistance = referenceNotes.length;
    }

    // Each note will be given an equal range of y values on the sine equation
    var interval = MAX_Y / (referenceNotes.length - 1);
    var sinGenerator = SinGenerator(deltaX());
    var pattern = [];
    var diffMappings = {};
    var prevIndex = null;
    for (var i = 0; i < noteCount; i++) {
        var yVal = sinGenerator.next().value;
        // Divide the y value by the frequency range to find the nearest note
        var noteIndex = Math.round(+(yVal / interval).toFixed(PRECISION));
        var diff = noteIndex - (prevIndex || noteIndex);
        // Check if change in note distance is higher than the max allowed
        if (Math.abs(diff) > maxDistance) {
            var newDiff;
            
            if (diffMappings.hasOwnProperty(diff)) {
                // The replacement note for this note has already been chosen
                newDiff = diffMappings[diff];
            }
            else {
                // Replacement note not chosen yet, choose a random one
                // We want to replace notes with the same value every time, or it will add additional randomness to the result
                newDiff = randInt(1, maxDistance);
                if (noteIndex < prevIndex) {
                    newDiff *= -1;
                }
                diffMappings[diff] = newDiff;
            }
            noteIndex = prevIndex + newDiff;
        }
        pattern.push(referenceNotes[noteIndex]);
        prevIndex = noteIndex;
    }
    return pattern;
}

/**
 * Returns a random number (min <= result < max)
 * @param {number} min Minimum number to generate (inclusive)
 * @param {number} max Maximum number to generate (exclusive)
 * @returns {number} The random number chosen
 */
function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min));
}

/**
 * Calls a function that generates the base pattern repeatedly
 * @param {number} numRepeats Number of times to generate the patten
 * @param {Function} repeatFunc Function that generates one iteration of the pattern
 * @returns {string} The new pattern
 */
function getPattern(numRepeats, repeatFunc) {
    var result = '';
    for (var i = 0; i < numRepeats; i++) {
        result += repeatFunc();
    }
    return result;
}

/**
 * Generates a pattern with a random note durations and number of rests
 * @param {number} underscoreMaxRepeat Maximum number of additional beats to hold the note for
 * @param {number} dashMaxRepeat Maximum number of rests per iteration
 * @param {number} noteRepeat Number of notes in the pattern
 * @returns {string} The new pattern
 */
function getRandPattern(underscoreMaxRepeat, dashMaxRepeat, noteRepeat) {
    return getPattern(noteRepeat, () => ('x' + 
        '_'.repeat(randInt(underscoreMaxRepeat)) + 
        '-'.repeat(randInt(dashMaxRepeat))));
}

/**
 * Alternates 0 and 1 rest per note
 * @param {number} noteRepeat Number of notes in the pattern
 * @returns {string} The new pattern
 */
function getSwingPattern(noteRepeat) {
    var count = 1;
    return getPattern(noteRepeat, () => ('x' + '_'.repeat(count++ % 2)));
}

/**
 * Generates a pattern that holds each note for one additional beat
 * @param {number} noteRepeat Number of notes in the pattern
 * @returns {string} The new pattern
 */
function getNormalPattern(noteRepeat) {
    return 'x_'.repeat(noteRepeat);
}

/**
 * Generates a random pattern according to the Markov chain
 * @param {number} noteRepeat Number of notes in the pattern
 * @param {number} patternCount Number of times to return the pattern
 * @returns {string} The new pattern
 */
function getMarkovPattern(noteRepeat, patternCount) {
    if (noteRepeat % patternCount !== 0) {
        throw 'Number of notes does not evenly fit in to the pattern count'
    }
    // Create a node for each row in the matrix
    // Each row index represents the amount of rests the node will have
    var nodes = ProbabilityMatrix.map(function(value, index) {
        return new MarkovNode(index);
    });
    // Seed the chain at row 0 (0 rests)
    var chain = new MarkovChain(nodes[0]);
    // Each node will have a link to every other node (including itself)
    // These links are the transitions from the number of rests defining the current row to all the other available number of rests
    ProbabilityMatrix.forEach(function(row, rowIndex) {
        var currentProb = 0;
        var baseNode = nodes[rowIndex];

        row.forEach(function(colProb, colIndex) {
            // Add nodes representing the 4 rows as links to the baseNode (current row)
            // Each column index represents the link to the node at the equivalent row index
            chain.addLink(baseNode, nodes[colIndex], currentProb, currentProb + colProb);
            currentProb += colProb;
        });
    });

    // Create the pattern by checking the markov chain state
    return getPattern(noteRepeat / patternCount, () => ('x' + '_'.repeat(chain.getNextState()))).repeat(patternCount);
}

/**
 * Trims a string or array into even partitions until the desired length is reached
 * @param {*} trimVal String or array to trim
 * @param {number} desiredLength Desired length of new string or array
 * @param {number} partitionCount Number of times to partition the string or array to trim excess values
 * @returns {string} The new patttern
 */
function evenlyTrim(trimVal, desiredLength, partitionCount) {
    var trimFunc;
    var addFunc;
    var newVal;
    var trimCopy;
    // Define behavior to modify strings or arrays
    if (typeof trimVal === 'string') {
        trimFunc = (stringVal, start, end) => stringVal.substring(start, end); 
        addFunc = (cur, add) => cur + add;
        newVal = '';
        trimCopy = trimVal;
    }
    else {
        trimFunc = (arrayVal, start, end) => arrayVal.slice(start, end);
        addFunc = (cur, add) => cur.concat(add);
        newVal = [];
        trimCopy = trimVal.slice();
    }
    // Current length of each partition
    var subLength = trimVal.length / partitionCount;
    // Desired length of each partition
    var subDesiredLength = desiredLength / partitionCount;
    // Repeatedly trim excess from each partition
    for (var start = 0; start < trimVal.length; start += subLength) {
        var curVal = trimFunc(trimCopy, start, start + subLength);
        newVal = addFunc(newVal, trimFunc(curVal, 0, subDesiredLength));
    }
    return newVal;
}

/**
 * Trims the pattern to have the specified number of beats and repeats
 * @param {string} pattern Pattern to trim
 * @param {number} numBeats Desired number of beats to return
 * @param {number} repeatCount Number of times to repeat pattern
 * @returns {string} The new pattern
 */
function trimPattern(pattern, numBeats, repeatCount) {
    return evenlyTrim(pattern, numBeats, repeatCount);
}
/**
 * Trims the note array to remove any extra notes that won't fit in the pattern
 * @param {string[]} notes Note array to trim
 * @param {string} pattern Pattern that is used with the notes
 * @param {number} repeatCount Number of times to repeat notes
 * @returns {string[]} The new note array
 */
function trimNotes(notes, pattern, repeatCount) {
    var noteCount = pattern.match(/x/g).length;
    return evenlyTrim(notes, noteCount, repeatCount);
}

/**
 * Chooses random notes and replaces them with notes in the selection, but will preserve intervals in terms of which sequences are increasing and decreasing
 * @param {string[]} notes Notes to alter 
 * @param {string[]} replaceSelection Selection of notes to choose replacements from
 * @param {number} replaceCount Number of notes to replace
 * @returns {string[]} The new note array
 */
function alterNotes(notes, replaceSelection, replaceCount) {
    var notesCopy = notes.slice();
    var alreadyReplaced = [];
    for (var i = 0; i < replaceCount; i++) {
        // Keep choosing a random note until we find one that hasn't been replaced already
        var next;
        do {
            next = randInt(0, notes.length - 1);
        }
        while (alreadyReplaced.indexOf(next) > 0);     
        alreadyReplaced.push(next);
        
        var prevNoteIndex = next > 0 ? replaceSelection.indexOf(notesCopy[next - 1]) : 0;
        var nextNoteIndex = next < notes.length - 1 ? replaceSelection.indexOf(notesCopy[next + 1]) : notes.length - 1;
        var curNoteIndex = replaceSelection.indexOf(notesCopy[next]);

        // Get highest and lowest notes of the chosen note and the two adjacent notes
        // The new note shouldn't change the increasing or decreasing intervals between the three notes
        var max = Math.max(prevNoteIndex, nextNoteIndex, curNoteIndex);
        var min = Math.min(prevNoteIndex, nextNoteIndex, curNoteIndex);
        // If the chosen note is currently the highest, we can choose any note higher than the max of the two adjacent notes
        if (max === curNoteIndex) {
            min = Math.max(prevNoteIndex, nextNoteIndex);
            max = replaceSelection.length;
        }
        // If the chosen note is the lowest, we can choose any note lower than the min of the two adjacent notes
        if (min === curNoteIndex) {
            max = Math.min(prevNoteIndex, nextNoteIndex);
            min = -1;
        }
        notesCopy[next] = replaceSelection[randInt(min + 1, max)];
    }
    return notesCopy;
}

/**
 * Creates a midi clip
 * @param {string[]} notes list of notes to choose from
 * @param {number} patternLength Maximum length for the pattern
 * @param {number} options.timesToPlayClip How many times to repeat the entire clip
 * @param {number} options.timesToPlayRhythm How many times to repeat the pattern that is created
 * @param {number} options.alterNoteCount Number of notes to replace with another random note while performing the note-altering operation (note relationships will be preserved)
 * @param {number} options.alterCount Number of times to repeat the note altering operation
 * @param {string[]} options.alterScale List of notes to choose from when altering notes
 * @param {string} options.noteLength How long each note or rest in the pattern will last for
 * @param {string} options.filename The name to save the midi file as
 * @param {boolean} options.repeatNotes Repeat notes if the number of notes supplied does not meet the pattern length
 * @param {PatternType} options.patternType Which type of pattern to create
 * @param {string} options.manualPattern Manual pattern to supply if patternType = PatternType.Manual
 */
function makeClip(notes, patternLength, {timesToPlayClip = 1, timesToPlayRhythm = 1, alterCount = 0, alterNoteCount = 0, alterScale = [],
    noteLength = '1/4', filename = 'music.mid', repeatNotes = false, patternType = PatternType.Normal, manualPattern = ''}) {
    // Max characters to include in the pattern (normalized to a quarter note)
    var patternCharCount = patternLength / (eval(noteLength) * 4);
    if (repeatNotes) {
        notes = repeatArray(notes, patternCharCount);
    }
    var pattern;
    switch (patternType) {
        case PatternType.Swing:
            pattern = getSwingPattern(notes.length);
            break;
        case PatternType.Random:
            // Defaulting to one beat to hold note for and no rests per iteration, may want to make this more configurable
            pattern = getRandPattern(1, 0, notes.length);
            break;
        case PatternType.Manual:
            pattern = manualPattern;
            break;
        case PatternType.Markov:
            pattern = getMarkovPattern(notes.length, timesToPlayRhythm);
            break;
        case PatternType.Normal:
            pattern = getNormalPattern(notes.length);
            break;
        default:
            throw 'Unrecognized or null pattern type'
    }

    if (patternLength != null) {
        pattern = trimPattern(pattern, patternCharCount, timesToPlayRhythm);
        notes = trimNotes(notes, pattern, timesToPlayRhythm);
    }
    
    notes = flatten(_.range(alterCount + 1).map(i => alterNotes(notes, alterScale, alterNoteCount)))
    pattern = pattern.repeat(alterCount + 1);
    
    var clip = scribble.clip({
        notes: notes,
        pattern: pattern,
        sizzle: false,
        shuffle: false,
        noteLength: noteLength
    });
    var fullClip = repeatArray(clip, timesToPlayClip);
    // Write the clip data to a json file so it can be reloaded and reused later if you want to make small changes to it
    fs.writeFileSync(`jsonBackups/${filename.split('.mid')[0]}.json`, JSON.stringify({notes, pattern, noteLength}), 'utf-8');
    scribble.midi(fullClip, `midi/${filename}`);
}

/**
 * Creates a scale spanning multiple octaves
 * @param {string} note Base note for the scale
 * @param {string} mode Name of the mode or scale
 * @param {number} low Lowest octave to include (inclusive)
 * @param {number} high Highest octave to include (exclusive)
 * @returns {string[]} Scale array
 */
function multiOctaveScale(note, mode, low, high) {
    return flatten(_.range(low, high).map(i => scribble.scale(note, mode, i)))
}

/**
 * Returns a wrapper on top of the makeClip function that has options preset, so you don't have to re-add the same options for multiple clips
 * @param {number} patternLength Max length for the pattern
 * @param {object} options Default options to use
 * @returns {Function} wrapper on top of makeClip that accepts the notes and any other options
 */
function presetClip(patternLength, options) {
    return function(notes, extraOptions) {
        makeClip(notes, patternLength, Object.assign(options, extraOptions));
    }
}

// Notes can be an array of arrays to use chords
// Use scribble.listChords() to see available chord types
var notes = [scribble.chord('CMaj4'), scribble.chord('EMin74'), scribble.chord('Dsus4')]
// Or specify the chord notes directly
var notes = [['c4', 'a5', 'e4'], ['a4', 'd4', 'e4']]
// Or mix and match
var notes = ['g4', 'b5', 'e6', 'f#6', ['g4', 'b5'], ['e6', 'f#6'], ['b5', 'e6']];

var scale = multiOctaveScale('f#', 'minor', 4, 6);

// Using a sine wave to generate notes
var notes = getNotes(function*() {
    // Put whatever crazy stuff you want in here
    // Linear changes in x will generate notes that change in a more periodic, predictable way
    // More complex or random changes in x may result in more unpredictable patterns
    var x = 0.14;
    while (true) {
        yield Math.pow(x, 2);
        x += x;
    }
}, scale, 8, 2);

// Running this multiple times will give different results due to the randomness in note altering and the markov chain
makeClip(notes, 8, {
    noteLength: '1/16', 
    patternType: PatternType.Markov, 
    timesToPlayClip: 1, 
    timesToPlayRhythm: 1,
    alterCount: 2,
    alterNoteCount: 2,
    alterScale: scale,
    repeatNotes: false
});

var scale = multiOctaveScale('f#', 'minor', 2, 6);
// This will produce a pattern that closely follows the scale
var notes = getNotes(function*() {
    var x = 0;
    while (true) {
        yield x;
        x += .05;
    }
}, scale, 8);

makeClip(notes, 8, {
    noteLength: '1/16', 
    patternType: PatternType.Normal, 
    timesToPlayClip: 1, 
    timesToPlayRhythm: 1,
    alterCount: 0,
    alterNoteCount: 0,
    alterScale: scale,
    repeatNotes: true,
    filename: 'music2.mid'
});

// One option to make drum beats is to use presets and single-note arrays
var preset = presetClip(4, {
    timesToPlay: 4, 
    repeatNotes: true,
    noteLength: '1/8', 
    patternType: PatternType.Markov
});
preset(['g4'], {filename: 'bass.mid', noteLength: '1/4'});
preset(['b4'], {filename: 'snare.mid'});
preset(['f#4'], {filename: 'hihat.mid', noteLength: '1/16'});
preset(['c4'], {filename: 'tom1.mid', noteLength: '1/16'});
preset(['d4'], {filename: 'tom2.mid', noteLength: '1/16'});