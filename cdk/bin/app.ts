#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AnghamiPlusStack } from '../lib/stack';

const app = new cdk.App();
new AnghamiPlusStack(app, 'AnghamiPlusStack');
