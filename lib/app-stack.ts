import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Database } from './database-construct';

class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const database = new Database(this, 'Database')
  }
}

export class AppStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props?: cdk.StageProps) {
    super(scope, id, props);
    const appStack = new AppStack(this, 'AppStack', props);
  }
}