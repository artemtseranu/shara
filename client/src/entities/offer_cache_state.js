import {
  List, Map, Record, Set,
} from 'immutable';

import { partialRight, pipe } from 'ramda';

import { findAndDelete } from 'Lib/list_utils';
import { parseEvents } from 'Lib/offer_cache_utils';

import * as Offer from './offer';
import * as OfferDetails from './offer_details';
import * as OfferAttributes from './offer_attributes';
import * as Operation from './operation';

export const OfferCacheState = Record({ // eslint-disable-line import/prefer-default-export
  createdOffers: Map(),

  offers: Map(),
  offerIds: List(),
  deletedOfferIds: Set(),
  myOfferIds: List(),
  pendingOffers: List(),

  earliestBlock: undefined,
});

export function getOffer(state, id) {
  return state.getIn(['offers', id]);
}

export function getOffers(offerCache) {
  return offerCache.get('offerIds').map(id => getOffer(offerCache, id));
}

export function getMyOfferIds(state) {
  return state.get('myOfferIds');
}

export function getMyOffers(state) {
  return getMyOfferIds(state).map(id => getOffer(state, id));
}

export function getPendingOffers(state) {
  return state.get('pendingOffers');
}

export function addCreatedOffers(state, offers) {
  return state.mergeIn(['createdOffers'], offers);
}

// TODO: REMOVE
export function addOffers(state, newOffers) {
  return state.update('offers', offers => newOffers.merge(offers));
}

export function addOffer(state, id, offer) {
  return state.setIn(['offers', id], offer);
}

export function addMyOfferIds(state, ids) {
  return state.update('myOfferIds', list => list.unshift(...ids));
}

export function addNewMyOfferId(state, id) {
  return state.update('myOfferIds', list => list.push(id));
}

export function addPendingOffer(state, offer) {
  return state.update('pendingOffers', list => list.push(offer));
}

export function removePendingOffer(state, transactionHash) {
  return state.update('pendingOffers', list => (
    findAndDelete(list, offer => Offer.getTransactionHash(offer) === transactionHash)
  ));
}

export function addNewMyOffer(state, transactionHash, attributes) {
  const id = OfferAttributes.getId(attributes);
  const pendingOffer = getPendingOffers(state).find(offer => (
    Offer.getTransactionHash(offer) === transactionHash
  ));

  if (pendingOffer) {
    const offer = Offer.setAttributes(pendingOffer, attributes);

    return pipe(
      partialRight(removePendingOffer, [transactionHash]),
      partialRight(addOffer, [id, offer]),
      partialRight(addNewMyOfferId, [id]),
    )(state);
  }

  const offer = Offer.Offer({ transactionHash, attributes });

  return pipe(
    partialRight(addOffer, [id, offer]),
    partialRight(addNewMyOfferId, [id]),
  )(state);
}

export function markOfferDetailsLoaddingInProgress(state, id) {
  return state.setIn(['offers', id, 'details', 'status'], 'inProgress');
}

export function markOfferDetailsLoaddingLoaded(state, id, details) {
  return state
    .setIn(['offers', id, 'details', 'status'], 'loaded')
    .setIn(['offers', id, 'details', 'content'], OfferDetails.from(details));
}

export function markOfferDetailsLoaddingFailed(state, id, errorMessage) {
  return state
    .setIn(['offers', id, 'details', 'status'], 'failed')
    .setIn(['offers', id, 'details', 'errorMessage'], errorMessage);
}

export function updateOnMyOffersInitSucceeded(offerCache, event) {
  const parsedEvents = parseEvents({
    offerCreatedEvents: event.offerCreatedEvents,
    offerDeletedEvents: event.offerDeletedEvents,
    deletedOfferIds: offerCache.get('deletedOfferIds'),
  });

  return offerCache
    .update('offers', map => map.merge(parsedEvents.get('offers')))
    .update('myOfferIds', list => list.unshift(...parsedEvents.get('offerIds')))
    .set('deletedOfferIds', parsedEvents.get('deletedOfferIds'));
}

export function updateOnDiscoverOffersInitSucceeded(offerCache, event) {
  const parsedEvents = parseEvents({
    offerCreatedEvents: event.offerCreatedEvents,
    offerDeletedEvents: event.offerDeletedEvents,
    deletedOfferIds: offerCache.get('deletedOfferIds'),
  });

  return offerCache
    .update('offers', map => map.merge(parsedEvents.get('offers')))
    .update('offerIds', list => list.unshift(...parsedEvents.get('offerIds')))
    .set('deletedOfferIds', parsedEvents.get('deletedOfferIds'))
    .set('earliestBlock', event.earliestBlock);
}

export function updateOnLoadMoreOffersSucceeded(offerCache, event) {
  const parsedEvents = parseEvents({
    offerCreatedEvents: event.offerCreatedEvents,
    offerDeletedEvents: event.offerDeletedEvents,
    deletedOfferIds: offerCache.get('deletedOfferIds'),
  });

  return offerCache
    .update('offers', map => map.merge(parsedEvents.get('offers')))
    .update('offerIds', list => list.unshift(...parsedEvents.get('offerIds')))
    .set('deletedOfferIds', parsedEvents.get('deletedOfferIds'))
    .set('earliestBlock', event.newEarliestBlock);
}

function updateOfferLoadDetails(offerCache, id, loadDetails) {
  return offerCache.updateIn(['offers', id], offer => offer.set('loadDetails', loadDetails));
}

export function updateOnLoadOfferDetailsSucceeded(offerCache, event) {
  const details = OfferDetails.fromJSON(event.details);
  const loadDetails = Operation.success(details);
  return updateOfferLoadDetails(offerCache, event.id, loadDetails);
}

export function updateOnLoadOfferDetailsFailed(offerCache, event) {
  const loadDetails = Operation.failure(event.errorMessage);
  return updateOfferLoadDetails(offerCache, event.id, loadDetails);
}

export function updateOnOfferCreated(offerCache, event) {
  const { transactionHash, args } = event.offerCreatedEvent;
  const id = parseInt(args.id, 10);
  const attributes = OfferAttributes.OfferAttributes({ ...args, id });

  const [pendingOffer, updatedPendingOffers] = findAndDelete(
    offerCache.get('pendingOffers'),
    _pendingOffer => _pendingOffer.get('transactionHash') === transactionHash,
  );

  let updatedOfferCache = offerCache;
  let offer;

  if (pendingOffer) {
    offer = pendingOffer.set('attributes', attributes);
    updatedOfferCache = updatedOfferCache.set('pendingOffers', updatedPendingOffers);
  } else {
    offer = Offer.Offer({ transactionHash, attributes });
  }

  updatedOfferCache = updatedOfferCache
    .setIn(['offers', id], offer)
    .update('offerIds', list => list.push(id));

  if (event.isOwned) {
    updatedOfferCache = updatedOfferCache.update('myOfferIds', list => list.push(id));
  }

  return updatedOfferCache;
}

export function updateOnOfferDeleted(offerCache, { offerDeletedEvent }) {
  const id = parseInt(offerDeletedEvent.args.id, 10);

  let updatedOfferCache = offerCache;

  if (offerCache.get('offers').has(id)) {
    updatedOfferCache = updatedOfferCache.deleteIn(['offers', id]);
    const offerIdIdx = offerCache.get('offerIds').indexOf(id);

    if (offerIdIdx > -1) {
      updatedOfferCache = updatedOfferCache.deleteIn(['offerIds', offerIdIdx]);
    }

    const myOfferIdIdx = offerCache.get('myOfferIds').indexOf(id);

    if (myOfferIdIdx > -1) {
      updatedOfferCache = updatedOfferCache.deleteIn(['myOfferIds', myOfferIdIdx]);
    }
  } else {
    updatedOfferCache = updatedOfferCache.update('deletedOfferIds', set => set.add(id));
  }

  return updatedOfferCache;
}
