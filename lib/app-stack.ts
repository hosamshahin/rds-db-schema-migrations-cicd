import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Database } from './database-construct';

class AppStack extends cdk.Stack {
  public readonly lambdaFunctionName: string;
  public readonly crossAccountLambdaInvokeRoleName: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const database = new Database(this, 'Database', { stageName: 'prod' })

    this.lambdaFunctionName = database.lambdaFunctionName;
    this.crossAccountLambdaInvokeRoleName = database.crossAccountLambdaInvokeRoleName;
  }
}

export class AppStage extends cdk.Stage {
  public readonly lambdaFunctionName: string;
  public readonly crossAccountLambdaInvokeRoleName: string;

  constructor(scope: Construct, id: string, props?: cdk.StageProps) {
    super(scope, id, props);

    const appStack = new AppStack(this, 'AppStack', props);

    this.lambdaFunctionName = appStack.lambdaFunctionName;
    this.crossAccountLambdaInvokeRoleName = appStack.crossAccountLambdaInvokeRoleName;
  }
}