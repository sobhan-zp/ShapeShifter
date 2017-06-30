import 'rxjs/add/operator/first';
import 'rxjs/add/observable/combineLatest';

import { Injectable } from '@angular/core';
import { Action } from '@ngrx/store';
import { ModelUtil } from 'app/scripts/common';
import { Layer, LayerUtil, VectorLayer } from 'app/scripts/model/layers';
import { ColorProperty, PathProperty } from 'app/scripts/model/properties';
import { Animation, AnimationBlock } from 'app/scripts/model/timeline';
import { State, Store } from 'app/store';
import {
  ReplaceLayer,
  SetCollapsedLayers,
  SetHiddenLayers,
  SetSelectedLayers,
} from 'app/store/layers/actions';
import {
  getCollapsedLayerIds,
  getHiddenLayerIds,
  getSelectedLayerIds,
  getVectorLayer,
} from 'app/store/layers/selectors';
import { MultiAction } from 'app/store/multiaction/actions';
import { ReplaceAnimation, SelectAnimation, SetSelectedBlocks } from 'app/store/timeline/actions';
import {
  getAnimation,
  getSelectedBlockIds,
  isAnimationSelected,
} from 'app/store/timeline/selectors';
import * as _ from 'lodash';
import { OutputSelector } from 'reselect';

/**
 * A simple service that provides an interface for making layer/timeline changes.
*/
@Injectable()
export class LayerTimelineService {
  constructor(private readonly store: Store<State>) {}

  /**
   * Selects or deselects the animation.
   */
  selectAnimation(isSelected: boolean) {
    this.updateSelections(isSelected, new Set(), new Set());
  }

  /**
   * Selects or deselects the specified block ID.
   */
  selectBlock(blockId: string, clearExisting: boolean) {
    this.store.dispatch(new MultiAction(...this.buildSelectBlockActions(blockId, clearExisting)));
  }

  private buildSelectBlockActions(blockId: string, clearExisting: boolean) {
    const selectedBlockIds = this.getSelectedBlockIds();
    if (clearExisting) {
      selectedBlockIds.forEach(id => {
        if (id !== blockId) {
          selectedBlockIds.delete(id);
        }
      });
    }
    if (!clearExisting && selectedBlockIds.has(blockId)) {
      selectedBlockIds.delete(blockId);
    } else {
      selectedBlockIds.add(blockId);
    }
    return [
      new SelectAnimation(false),
      new SetSelectedBlocks(selectedBlockIds),
      new SetSelectedLayers(new Set()),
    ];
  }

  /**
   * Selects or deselects the specified layer ID.
   */
  selectLayer(layerId: string, clearExisting: boolean) {
    const selectedLayerIds = this.getSelectedLayerIds();
    if (clearExisting) {
      selectedLayerIds.forEach(id => {
        if (id !== layerId) {
          selectedLayerIds.delete(id);
        }
      });
    }
    if (!clearExisting && selectedLayerIds.has(layerId)) {
      selectedLayerIds.delete(layerId);
    } else {
      selectedLayerIds.add(layerId);
    }
    this.updateSelections(false, new Set(), selectedLayerIds);
  }

  /**
   * Clears all animation/block/layer selections.
   */
  clearSelections() {
    this.updateSelections(false, new Set(), new Set());
  }

  private updateSelections(
    isAnimationSelected: boolean,
    selectedBlockIds: Set<string>,
    selectedLayerIds: Set<string>,
  ) {
    this.store.dispatch(
      new MultiAction(
        new SelectAnimation(isAnimationSelected),
        new SetSelectedBlocks(selectedBlockIds),
        new SetSelectedLayers(selectedLayerIds),
      ),
    );
  }

  /**
   * Toggles the specified layer's expanded state.
   */
  toggleExpandedLayer(layerId: string, recursive: boolean) {
    const layerIds = new Set([layerId]);
    if (recursive) {
      const layer = this.getVectorLayer().findLayerById(layerId);
      if (layer) {
        layer.walk(l => layerIds.add(l.id));
      }
    }
    const collapsedLayerIds = this.getCollapsedLayerIds();
    if (collapsedLayerIds.has(layerId)) {
      layerIds.forEach(id => collapsedLayerIds.delete(id));
    } else {
      layerIds.forEach(id => collapsedLayerIds.add(id));
    }
    this.store.dispatch(new SetCollapsedLayers(layerIds));
  }

  /**
   * Toggles the specified layer's visibility.
   */
  toggleVisibleLayer(layerId: string) {
    const layerIds = this.getHiddenLayerIds();
    if (layerIds.has(layerId)) {
      layerIds.delete(layerId);
    } else {
      layerIds.add(layerId);
    }
    this.store.dispatch(new SetHiddenLayers(layerIds));
  }

  /**
   * Imports a list of vector layers into the workspace.
   */
  importLayers(importedVls: ReadonlyArray<VectorLayer>) {
    if (!importedVls.length) {
      return;
    }
    let mergeVls: VectorLayer[];
    const currVl = this.getVectorLayer();
    if (currVl.children.length) {
      // Merge the imported vector layers with the current vector layer.
      mergeVls = [currVl, ...importedVls];
    } else {
      // Simply replace the current vector layer rather than merging with it.
      const [vl, ...vls] = importedVls;
      mergeVls = [vl.clone(), ...vls];
    }
    this.replaceLayer(
      mergeVls.length === 1 ? mergeVls[0] : mergeVls.reduce(LayerUtil.mergeVectorLayers),
    );
  }

  /**
   * Adds a layer to the vector tree.
   */
  addLayer(layer: Layer) {
    const vl = this.getVectorLayer();
    const selectedLayers = this.getSelectedLayers();
    if (selectedLayers.length === 1) {
      const selectedLayer = selectedLayers[0];
      if (!(selectedLayer instanceof VectorLayer)) {
        // Add the new layer as a sibling to the currently selected layer.
        const parent = LayerUtil.findParent(vl, selectedLayer.id).clone();
        const children = parent.children.slice();
        parent.children = children.concat([layer]);
        this.replaceLayer(LayerUtil.replaceLayerInTree(vl, parent));
        return;
      }
    }
    const vectorLayer = vl.clone();
    vl.children = [...vl.children, layer];
    this.replaceLayer(vl);
  }

  replaceLayer(layer: Layer) {
    this.store.dispatch(new ReplaceLayer(layer));
  }

  deleteSelectedModels() {
    const collapsedLayerIds = this.getCollapsedLayerIds();
    const hiddenLayerIds = this.getHiddenLayerIds();
    const selectedLayerIds = this.getSelectedLayerIds();

    let vectorLayer = this.getVectorLayer();
    if (selectedLayerIds.has(vectorLayer.id)) {
      vectorLayer = new VectorLayer();
      collapsedLayerIds.clear();
      hiddenLayerIds.clear();
    } else {
      selectedLayerIds.forEach(layerId => {
        vectorLayer = LayerUtil.removeLayersFromTree(vectorLayer, layerId);
        collapsedLayerIds.delete(layerId);
        hiddenLayerIds.delete(layerId);
      });
    }

    let animation = this.getAnimation();
    if (this.isAnimationSelected()) {
      animation = new Animation();
    }

    const selectedBlockIds = this.getSelectedBlockIds();
    if (selectedBlockIds.size) {
      animation = animation.clone();
      animation.blocks = animation.blocks.filter(b => !selectedBlockIds.has(b.id));
    }

    this.store.dispatch(
      new MultiAction(
        new ReplaceLayer(vectorLayer),
        new SetCollapsedLayers(collapsedLayerIds),
        new SetHiddenLayers(hiddenLayerIds),
        new SetSelectedLayers(new Set()),
        new SelectAnimation(false),
        new ReplaceAnimation(animation),
        new SetSelectedBlocks(new Set()),
      ),
    );
  }

  replaceBlocks(blocks: ReadonlyArray<AnimationBlock>) {
    if (!blocks.length) {
      return;
    }
    const animation = this.getAnimation().clone();
    animation.blocks = animation.blocks.map(block => {
      const newBlock = _.find(blocks, b => block.id === b.id);
      return newBlock ? newBlock : block;
    });
    this.store.dispatch(new ReplaceAnimation(animation));
  }

  addBlock(layer: Layer, propertyName: string, fromValue: any, toValue: any, activeTime: number) {
    let animation = this.getAnimation();
    const newBlockDuration = 100;

    // Find the right start time for the block, which should be a gap between
    // neighboring blocks closest to the active time cursor, of a minimum size.
    const blocksByLayerId = ModelUtil.getOrderedBlocksByPropertyByLayer(animation);
    const blockNeighbors = (blocksByLayerId[layer.id] || {})[propertyName] || [];
    let gaps: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < blockNeighbors.length; i++) {
      gaps.push({
        start: i === 0 ? 0 : blockNeighbors[i - 1].endTime,
        end: blockNeighbors[i].startTime,
      });
    }
    gaps.push({
      start: blockNeighbors.length ? blockNeighbors[blockNeighbors.length - 1].endTime : 0,
      end: animation.duration,
    });
    gaps = gaps
      .filter(gap => gap.end - gap.start > newBlockDuration)
      .map(gap =>
        Object.assign(gap, {
          dist: Math.min(Math.abs(gap.end - activeTime), Math.abs(gap.start - activeTime)),
        }),
      )
      .sort((a, b) => a.dist - b.dist);

    if (!gaps.length) {
      // No available gaps, cancel.
      // TODO: show a disabled button to prevent this case?
      console.warn('Ignoring failed attempt to add animation block');
      return;
    }

    let startTime = Math.max(activeTime, gaps[0].start);
    const endTime = Math.min(startTime + newBlockDuration, gaps[0].end);
    if (endTime - startTime < newBlockDuration) {
      startTime = endTime - newBlockDuration;
    }

    // Generate the new block.
    const property = layer.animatableProperties.get(propertyName);
    const typeMap = {
      PathProperty: 'path',
      ColorProperty: 'color',
      NumberProperty: 'number',
    };

    // TODO: clone the current rendered property value and set the from/to values appropriately
    // const valueAtCurrentTime =
    //   this.studioState_.animationRenderer
    //     .getLayerPropertyValue(layer.id, propertyName);

    const newBlock = AnimationBlock.from({
      layerId: layer.id,
      propertyName,
      startTime,
      endTime,
      fromValue,
      toValue,
      type: typeMap[property.getTypeName()],
    });
    animation = animation.clone();
    animation.blocks = animation.blocks.concat(newBlock);

    this.store.dispatch(
      new MultiAction(
        new ReplaceAnimation(animation),
        // Auto-select the new animation block.
        ...this.buildSelectBlockActions(newBlock.id, true),
      ),
    );
  }

  getVectorLayer() {
    return this.queryStore(getVectorLayer);
  }

  private getSelectedLayerIds() {
    return new Set(this.queryStore(getSelectedLayerIds));
  }

  getSelectedLayers() {
    const vl = this.getVectorLayer();
    return Array.from(this.getSelectedLayerIds()).map(id => vl.findLayerById(id));
  }

  private getHiddenLayerIds() {
    return new Set(this.queryStore(getHiddenLayerIds));
  }

  private getCollapsedLayerIds() {
    return new Set(this.queryStore(getCollapsedLayerIds));
  }

  private getSelectedBlockIds() {
    return new Set(this.queryStore(getSelectedBlockIds));
  }

  getSelectedBlocks() {
    const anim = this.getAnimation();
    const blockIds = this.getSelectedBlockIds();
    return Array.from(blockIds).map(id => _.find(anim.blocks, b => b.id === id));
  }

  getAnimation() {
    return this.queryStore(getAnimation);
  }

  isAnimationSelected() {
    return this.queryStore(isAnimationSelected);
  }

  private queryStore<T>(selector: OutputSelector<Object, T, (res: Object) => T>) {
    let obj: T;
    this.store.select(selector).first().subscribe(o => (obj = o));
    return obj;
  }
}
