import { Component, OnInit, OnDestroy } from '@angular/core';
import { AnimatorService } from '../services/animator.service';
import { Interpolator, INTERPOLATORS } from '../scripts/animation';
import { LayerStateService, MorphabilityStatus } from '../services/layerstate.service';
import { CanvasType } from '../CanvasType';
import { SettingsService } from '../services/settings.service';
import { Subscription } from 'rxjs/Subscription';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit, OnDestroy {
  interpolators = INTERPOLATORS;
  isMorphable = false;
  private startRotation_ = 0;
  private endRotation_ = 0;
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private animatorService: AnimatorService,
    private layerStateService: LayerStateService,
    private settingsService: SettingsService) { }

  ngOnInit() {
    this.subscriptions.push(
      this.layerStateService.getMorphabilityStatusObservable().subscribe(status => {
        this.isMorphable = status === MorphabilityStatus.Morphable;
      }));
  }

  ngOnDestroy() {
    this.subscriptions.forEach(s => s.unsubscribe());
  }

  get selectedInterpolator() {
    return this.animatorService.getInterpolator();
  }

  set selectedInterpolator(interpolator: Interpolator) {
    this.animatorService.setInterpolator(interpolator);
  }

  get duration() {
    return this.animatorService.getDuration();
  }

  // TODO: validate this input (i.e. between min/max values)
  set duration(duration: number) {
    this.animatorService.setDuration(duration);
  }

  get startRotation() {
    return this.startRotation_;
  }

  // TODO: remove the layer if both attributes are set to 0?
  // TODO: make these the rotation gets exported as well
  set startRotation(startRotation: number) {
    this.startRotation_ = startRotation;
    this.layerStateService.updateActiveRotationLayer(CanvasType.Start, startRotation);
    this.layerStateService.updateActiveRotationLayer(CanvasType.Preview, startRotation);
    this.layerStateService.updateActiveRotationLayer(CanvasType.End, this.endRotation);
  }

  get endRotation() {
    return this.endRotation_;
  }

  // TODO: remove the layer if both attributes are set to 0?
  // TODO: make these the rotation gets exported as well
  set endRotation(endRotation: number) {
    this.endRotation_ = endRotation;
    this.layerStateService.updateActiveRotationLayer(CanvasType.Start, this.startRotation);
    this.layerStateService.updateActiveRotationLayer(CanvasType.Preview, this.startRotation);
    this.layerStateService.updateActiveRotationLayer(CanvasType.End, endRotation);
  }

  get shouldLabelPoints() {
    return this.settingsService.shouldLabelPoints();
  }

  set shouldLabelPoints(shouldLabelPoints: boolean) {
    this.settingsService.setShouldLabelPoints(shouldLabelPoints);
  }

  isPlaying() {
    return this.animatorService.isPlaying();
  }
}
