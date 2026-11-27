'use strict';
// Filename abbreviations for docket entries. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { abbreviateBriefType, generateFilename } = require('../ctrack-fetch.js');

test('Brief-type entries get brief abbreviations', () => {
  assert.equal(abbreviateBriefType('Appellant Brief', '', 'Brief'), 'Apt-Br');
  assert.equal(abbreviateBriefType('Appellee Brief', '', 'Brief'), 'Ape-Br');
  assert.equal(abbreviateBriefType('REPLY BRIEF OF APPELLANT', '', 'Brief'), 'Apt-Reply-Br');
  assert.equal(abbreviateBriefType('APPELLEE BRIEF w/attached Addendum', '', 'Brief'), 'Ape-Br');
  assert.equal(abbreviateBriefType('AMICUS CURIAE BRIEF (NDTLA)', '', 'Brief'), 'Amicus-Br');
});

test('non-Brief entries that mention a brief are not named as briefs', () => {
  // A motion that names a brief (type Motion).
  const motion = abbreviateBriefType(
    'Motion for Extension of Time to File Appellant Brief', '', 'Motion');
  assert.notEqual(motion, 'Apt-Br');
  assert.match(motion, /^Motion-Extension/);

  // Clerk compliance notes (type Correction) and clerk actions.
  assert.notEqual(
    abbreviateBriefType('Appellant Brief filed, corrections needed', '', 'Correction'),
    'Apt-Br');
  assert.notEqual(
    abbreviateBriefType("Appellee's Brief filed, corrections needed", '', 'Correction'),
    'Ape-Br');
  assert.notEqual(
    abbreviateBriefType('Action by Clerk - Granted by Clerk (deadline for Appellant\'s Brief is now 6/5/25 by noon)', '', 'Action by Clerk'),
    'Apt-Br');
  assert.notEqual(
    abbreviateBriefType('MOTION TO STRIKE (Reply Brief)', '', 'Motion'),
    'Apt-Reply-Br');
});

test('notices of appeal keep their name; other entries mentioning one do not', () => {
  assert.equal(abbreviateBriefType('Notice of Appeal', 'Appeal', 'Notice'), 'Notice-of-Appeal');
  assert.equal(abbreviateBriefType('NOTICE OF APPEAL\nDue: 10/01/2014', '', 'Notice'), 'Notice-of-Appeal');
  assert.equal(abbreviateBriefType('Amended Notice of Appeal (redacted)', '', 'Notice'), 'Amended-Notice-of-Appeal');
  assert.notEqual(
    abbreviateBriefType('Granted by Chief Justice - Order Granting Extension of Time to File Notice of Appeal', '', 'Action by Chief Justice'),
    'Notice-of-Appeal');
});

test('callers that pass no type keep the old matching', () => {
  assert.equal(
    abbreviateBriefType('Motion for Extension of Time to File Appellant Brief'),
    'Apt-Br');
});

test('opinions are still keyed on the subtype', () => {
  assert.equal(abbreviateBriefType('Opinion - Opinion', 'Unanimous Opinion', 'Holding'), 'Opinion');
  assert.equal(abbreviateBriefType('Corrected Opinion', 'Opinion', 'Correction'), 'Opinion-Corrected');
});

test('generateFilename threads the entry type through', () => {
  assert.equal(
    generateFilename('20990001', 18, 'Appellant Brief', null, '', 'Brief'),
    '20990001_018_Apt-Br.pdf');
  const motion = generateFilename(
    '20990001', 14, 'Motion for Extension of Time to File Appellant Brief', null, '', 'Motion');
  assert.notEqual(motion, '20990001_014_Apt-Br.pdf');
  assert.match(motion, /^20990001_014_Motion-/);
});
