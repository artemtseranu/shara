import { namespace, operation } from 'Lib/event_utils';

const ns = namespace('eth');

export const REQUIRED = ns('required');
export const Init = operation(ns('init'));

export const MY_OFFER_CREATED = ns('my_offer_created');
